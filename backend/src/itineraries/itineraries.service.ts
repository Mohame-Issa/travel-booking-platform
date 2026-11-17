import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { type Connection, Model, Types } from 'mongoose';
import { ErrorCode } from '../common/constants/error-codes.js';
import { UserStatus } from '../common/constants/roles.js';
import type { Paginated } from '../common/dto/pagination.dto.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { paginate } from '../common/utils/paginate.js';
import { Country } from '../seed/schemas/reference-data.schema.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { User } from '../users/schemas/user.schema.js';
import type {
  CreateItineraryDto,
  ItineraryDetailDto,
  ItinerarySummaryDto,
  UpdateItineraryDto,
} from './dto/itinerary.dto.js';
import { toActivityDto } from './activities.service.js';
import { toEntryDto, toTransportDto } from './budgets.service.js';
import { buildCityGroups } from './city-groups.js';
import type { ActivityDto } from './dto/day.dto.js';
import { dayDate, parseIsoDate, toIsoDate } from './itinerary-dates.js';
import { Activity } from './schemas/activity.schema.js';
import { BudgetEntry } from './schemas/budget-entry.schema.js';
import { ItineraryDay } from './schemas/itinerary-day.schema.js';
import { Itinerary } from './schemas/itinerary.schema.js';
import { TransportCost } from './schemas/transport-cost.schema.js';

/** Fields of an itinerary as read with .lean(). */
type ItineraryRow = Itinerary & { _id: Types.ObjectId };

/**
 * Itinerary CRUD (ITN-01, ITN-03, ITN-20). Owner checks on :id routes are done
 * by @CheckOwnership in the controller (ACC-11).
 */
@Injectable()
export class ItinerariesService {
  constructor(
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    @InjectModel(ItineraryDay.name) private readonly days: Model<ItineraryDay>,
    @InjectModel(Activity.name) private readonly activities: Model<Activity>,
    @InjectModel(BudgetEntry.name) private readonly budgets: Model<BudgetEntry>,
    @InjectModel(TransportCost.name)
    private readonly transport: Model<TransportCost>,
    @InjectModel(Country.name) private readonly countriesRef: Model<Country>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectConnection() private readonly connection: Connection,
    private readonly uploads: UploadsService,
  ) {}

  /** POST /api/itineraries (ITN-01): private by default. */
  async create(
    userId: string,
    dto: CreateItineraryDto,
  ): Promise<ItinerarySummaryDto> {
    await this.assertCountries(dto.countries);
    const created = await this.itineraries.create({
      userId: new Types.ObjectId(userId),
      title: dto.title,
      countries: dto.countries,
      startDate: this.parseStartDate(dto.startDate),
    });
    return toSummary(created.toObject());
  }

  /** GET /api/itineraries (ITN-03): mine, most recently updated first, 10 per page. */
  async listMine(
    userId: string,
    page: number,
  ): Promise<Paginated<ItinerarySummaryDto>> {
    const result = await paginate(
      this.itineraries,
      { userId: new Types.ObjectId(userId) },
      { page, sort: { updatedAt: -1 } },
    );
    return {
      items: result.items.map((i) => toSummary(i as ItineraryRow)),
      meta: result.meta,
    };
  }

  /** GET /api/itineraries/:id (ITN-03): days, their activities and city groups. */
  async getDetail(id: string): Promise<ItineraryDetailDto> {
    const itinerary = await this.findOrFail(id);
    const [days, activities, entries, trips] = await Promise.all([
      this.days
        .find({ itineraryId: itinerary._id })
        .sort({ dayNumber: 1 })
        .lean()
        .exec(),
      this.activities
        .find({ itineraryId: itinerary._id })
        .sort({ createdAt: 1 })
        .lean()
        .exec(),
      this.budgets
        .find({ itineraryId: itinerary._id })
        .sort({ createdAt: 1 })
        .lean()
        .exec(),
      this.transport
        .find({ itineraryId: itinerary._id })
        .sort({ createdAt: 1 })
        .lean()
        .exec(),
    ]);
    const byDay = new Map<string, ActivityDto[]>();
    for (const a of activities) {
      const key = a.dayId.toString();
      byDay.set(key, [...(byDay.get(key) ?? []), toActivityDto(a)]);
    }
    const dayRows = days.map((d) => ({
      id: d._id.toString(),
      dayNumber: d.dayNumber,
      date: dayDate(itinerary.startDate, d.dayNumber),
      cityId: d.cityId,
      notes: d.notes,
      activities: (byDay.get(d._id.toString()) ?? []).sort(byTime),
      budgetEntries: entries
        .filter((e) => e.dayId.toString() === d._id.toString())
        .map(toEntryDto),
      transportCosts: trips
        .filter((t) => t.dayId.toString() === d._id.toString())
        .map(toTransportDto),
    }));
    const summary = toSummary(itinerary);
    if (summary.clonedFrom) {
      // ITN-21: the clone credits its original author ("Deleted user" if deactivated, ACC-12).
      const author = await this.users
        .findById(summary.clonedFrom.authorId, { name: 1, status: 1 })
        .lean()
        .exec();
      summary.clonedFrom.authorName =
        author && author.status !== UserStatus.DEACTIVATED
          ? author.name
          : 'Deleted user';
    }
    return Object.assign(summary, {
      days: dayRows,
      groups: buildCityGroups(itinerary.startDate, days),
    });
  }

  /**
   * PATCH /api/itineraries/:id: title, countries, start date (ITN-01) and
   * visibility (ITN-20). Changing the start date moves every day with it,
   * because day dates are derived, never stored (ITN-05).
   */
  async update(
    id: string,
    dto: UpdateItineraryDto,
  ): Promise<ItinerarySummaryDto> {
    if (dto.countries) await this.assertCountries(dto.countries);
    const set: Partial<Itinerary> = {};
    if (dto.title !== undefined) set.title = dto.title;
    if (dto.countries !== undefined) set.countries = dto.countries;
    if (dto.startDate !== undefined)
      set.startDate = this.parseStartDate(dto.startDate);
    // ITN-20: setting Private removes it from shared search immediately,
    // because public search only ever reads visibility = public.
    if (dto.visibility !== undefined) set.visibility = dto.visibility;

    const updated = await this.itineraries
      .findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: true })
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('Itinerary not found');
    return toSummary(updated as ItineraryRow);
  }

  /**
   * DELETE /api/itineraries/:id (ITN-01). Removes the itinerary with its days,
   * activities, budget entries and transport costs in one transaction, and
   * frees the activity images. Clones made by other users are separate
   * documents, so they stay unaffected (ITN-01).
   */
  async remove(id: string): Promise<void> {
    const itineraryId = new Types.ObjectId(id);
    const activityIds = await this.activities
      .find({ itineraryId })
      .distinct('_id')
      .exec();

    await this.connection.transaction(async (session) => {
      await this.activities.deleteMany({ itineraryId }, { session }).exec();
      await this.budgets.deleteMany({ itineraryId }, { session }).exec();
      await this.transport.deleteMany({ itineraryId }, { session }).exec();
      await this.days.deleteMany({ itineraryId }, { session }).exec();
      const res = await this.itineraries
        .deleteOne({ _id: itineraryId }, { session })
        .exec();
      if (res.deletedCount === 0)
        throw new NotFoundException('Itinerary not found');
    });

    // GEN-08: images go back to the uploader's unattached pool.
    for (const activityId of activityIds) {
      await this.uploads.detachOwner({
        type: 'activity',
        id: String(activityId),
      });
    }
  }

  async findOrFail(id: string): Promise<ItineraryRow> {
    const itinerary = await this.itineraries.findById(id).lean().exec();
    if (!itinerary) throw new NotFoundException('Itinerary not found');
    return itinerary as ItineraryRow;
  }

  /** ITN-01: countries come from the predefined list (Countries.csv, GEN-12). */
  private async assertCountries(codes: string[]): Promise<void> {
    const found = await this.countriesRef
      .find({ _id: { $in: codes } })
      .distinct('_id')
      .exec();
    const missing = codes.filter((c) => !found.includes(c));
    if (missing.length > 0) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.UNKNOWN_COUNTRY,
        `Unknown country code(s): ${missing.join(', ')}`,
        [
          {
            field: 'countries',
            messages: [`not in the country list: ${missing.join(', ')}`],
          },
        ],
      );
    }
  }

  private parseStartDate(value: string): Date {
    const date = parseIsoDate(value);
    if (!date) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Validation failed',
        [
          {
            field: 'startDate',
            messages: ['startDate must be a real calendar date (YYYY-MM-DD)'],
          },
        ],
      );
    }
    return date;
  }
}

export function toSummary(i: ItineraryRow): ItinerarySummaryDto {
  return {
    id: i._id.toString(),
    title: i.title,
    countries: i.countries,
    startDate: toIsoDate(i.startDate),
    endDate: i.dayCount > 0 ? dayDate(i.startDate, i.dayCount) : null,
    dayCount: i.dayCount,
    visibility: i.visibility,
    clonedFrom: i.clonedFrom
      ? {
          itineraryId: i.clonedFrom.itineraryId.toString(),
          authorId: i.clonedFrom.authorId.toString(),
        }
      : null,
    updatedAt: i.updatedAt,
  };
}

/** ITN-10: activities by time; those without a time come last, in creation order. */
function byTime(a: ActivityDto, b: ActivityDto): number {
  if (a.time === b.time) return 0;
  if (a.time === null) return 1;
  if (b.time === null) return -1;
  return a.time.localeCompare(b.time);
}

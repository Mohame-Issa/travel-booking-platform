import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { type Connection, Model, type QueryFilter, Types } from 'mongoose';
import { UserStatus } from '../common/constants/roles.js';
import type { Paginated } from '../common/dto/pagination.dto.js';
import { paginate } from '../common/utils/paginate.js';
import { City, Country } from '../seed/schemas/reference-data.schema.js';
import { User } from '../users/schemas/user.schema.js';
import { BudgetsService } from './budgets.service.js';
import type { ItineraryDetailDto } from './dto/itinerary.dto.js';
import type {
  PublicItineraryDetailDto,
  PublicItinerarySummaryDto,
  SearchPublicItinerariesDto,
} from './dto/public-itinerary.dto.js';
import { ItinerariesService, toSummary } from './itineraries.service.js';
import { Activity } from './schemas/activity.schema.js';
import { BudgetEntry } from './schemas/budget-entry.schema.js';
import { ItineraryDay } from './schemas/itinerary-day.schema.js';
import { Itinerary, ItineraryVisibility } from './schemas/itinerary.schema.js';
import { TransportCost } from './schemas/transport-cost.schema.js';

/** ACC-12: what a deactivated author's name shows as. */
export const DELETED_USER = 'Deleted user';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Public itineraries (ITN-20, ITN-21): shared search, read-only view and
 * cloning. Taken over from Omar Rashed's part.
 *
 * Visible publicly = visibility "public" (ITN-20), not hidden by an admin
 * (GEN-10), and the author is not deactivated (ACC-12).
 */
@Injectable()
export class PublicItinerariesService {
  constructor(
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    @InjectModel(ItineraryDay.name) private readonly days: Model<ItineraryDay>,
    @InjectModel(Activity.name) private readonly activities: Model<Activity>,
    @InjectModel(BudgetEntry.name) private readonly budgets: Model<BudgetEntry>,
    @InjectModel(TransportCost.name)
    private readonly transport: Model<TransportCost>,
    @InjectModel(Country.name) private readonly countries: Model<Country>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectConnection() private readonly connection: Connection,
    private readonly itinerariesService: ItinerariesService,
    private readonly budgetsService: BudgetsService,
  ) {}

  /** GET /api/itineraries/public/search (ITN-21). Newest updates first, 10 per page. */
  async search(
    q: SearchPublicItinerariesDto,
  ): Promise<Paginated<PublicItinerarySummaryDto>> {
    const and: QueryFilter<Itinerary>[] = [await this.visibleFilter()];

    if (q.q) {
      // Keyword: title, or a country / city whose name or code matches.
      const re = new RegExp(escapeRegex(q.q), 'i');
      const countryCodes = await this.countries
        .find({ $or: [{ name: re }, { _id: q.q.toUpperCase() }] })
        .distinct('_id')
        .exec();
      const cityIds = await this.cities
        .find({ $or: [{ name: re }, { _id: q.q.toLowerCase() }] })
        .distinct('_id')
        .exec();
      const inCities = cityIds.length
        ? await this.days
            .find({ cityId: { $in: cityIds } })
            .distinct('itineraryId')
            .exec()
        : [];
      and.push({
        $or: [
          { title: re },
          { countries: { $in: countryCodes } },
          { _id: { $in: inCities } },
        ],
      });
    }
    if (q.country) and.push({ countries: q.country });
    if (q.city) {
      and.push({
        _id: {
          $in: await this.days
            .find({ cityId: q.city })
            .distinct('itineraryId')
            .exec(),
        },
      });
    }
    if (q.minDays !== undefined || q.maxDays !== undefined) {
      and.push({
        dayCount: {
          ...(q.minDays !== undefined ? { $gte: q.minDays } : {}),
          ...(q.maxDays !== undefined ? { $lte: q.maxDays } : {}),
        },
      });
    }

    const page = await paginate(
      this.itineraries,
      { $and: and },
      { page: q.page, sort: { updatedAt: -1 } },
    );
    const names = await this.authorNames(page.items.map((i) => i.userId));
    return {
      items: page.items.map((i) => {
        const row = i as Itinerary & { _id: Types.ObjectId };
        return Object.assign(toSummary(row), {
          author: {
            id: row.userId.toString(),
            name: names.get(row.userId.toString()) ?? DELETED_USER,
          },
        });
      }),
      meta: page.meta,
    };
  }

  /** GET /api/itineraries/public/:id (ITN-21): read-only, with author, days, activities and budget. */
  async getPublic(
    id: string,
    currency?: string,
  ): Promise<PublicItineraryDetailDto> {
    const itinerary = await this.findVisible(id);
    const detail = await this.itinerariesService.getDetail(id);
    const author = await this.users
      .findById(itinerary.userId, { name: 1 })
      .lean()
      .exec();
    let budget = null;
    try {
      budget = await this.budgetsService.summary(id, null, currency);
    } catch (err) {
      // Exchange rates down and nothing cached: still show the itinerary.
      if (!(err instanceof HttpException)) throw err;
    }
    return Object.assign(detail, {
      author: {
        id: itinerary.userId.toString(),
        name: author?.name ?? DELETED_USER,
      },
      budget,
    });
  }

  /**
   * POST /api/itineraries/:id/clone (ITN-21): an independent private copy with
   * all days, activities, budget entries and transport costs, crediting the
   * original author. Activity images are not copied: an uploaded image belongs
   * to exactly one activity (GEN-08), so the clone starts without images.
   */
  async clone(id: string, userId: string): Promise<ItineraryDetailDto> {
    const source = await this.findVisible(id);
    const newId = await this.connection.transaction(async (session) => {
      const owner = new Types.ObjectId(userId);
      const [copy] = await this.itineraries.create(
        [
          {
            userId: owner,
            title: source.title,
            countries: source.countries,
            startDate: source.startDate,
            visibility: ItineraryVisibility.PRIVATE,
            dayCount: source.dayCount,
            clonedFrom: { itineraryId: source._id, authorId: source.userId },
          },
        ],
        { session },
      );
      const days = await this.days
        .find({ itineraryId: source._id })
        .session(session)
        .lean()
        .exec();
      const dayMap = new Map<string, Types.ObjectId>();
      for (const d of days) dayMap.set(d._id.toString(), new Types.ObjectId());
      const newDay = (old: Types.ObjectId) => dayMap.get(old.toString())!;
      const base = { itineraryId: copy._id, userId: owner };

      if (days.length) {
        await this.days.insertMany(
          days.map((d) => ({
            ...base,
            _id: newDay(d._id),
            dayNumber: d.dayNumber,
            cityId: d.cityId,
            notes: d.notes,
          })),
          { session },
        );
      }
      const [acts, entries, trips] = await Promise.all([
        this.activities
          .find({ itineraryId: source._id })
          .session(session)
          .lean()
          .exec(),
        this.budgets
          .find({ itineraryId: source._id })
          .session(session)
          .lean()
          .exec(),
        this.transport
          .find({ itineraryId: source._id })
          .session(session)
          .lean()
          .exec(),
      ]);
      if (acts.length) {
        await this.activities.insertMany(
          acts.map((a) => ({
            ...base,
            dayId: newDay(a.dayId),
            name: a.name,
            description: a.description,
            time: a.time,
            cost: a.cost,
            currency: a.currency,
            images: [],
          })),
          { session },
        );
      }
      if (entries.length) {
        await this.budgets.insertMany(
          entries.map((e) => ({
            ...base,
            dayId: newDay(e.dayId),
            category: e.category,
            amount: e.amount,
            currency: e.currency,
            note: e.note,
          })),
          { session },
        );
      }
      if (trips.length) {
        await this.transport.insertMany(
          trips.map((t) => ({
            ...base,
            dayId: newDay(t.dayId),
            mode: t.mode,
            fromCityId: t.fromCityId,
            toCityId: t.toCityId,
            amount: t.amount,
            currency: t.currency,
          })),
          { session },
        );
      }
      return copy._id.toString();
    });
    return this.itinerariesService.getDetail(newId);
  }

  /** Public, not hidden, author not deactivated; otherwise 404 (never reveal private ones). */
  private async findVisible(id: string) {
    const itinerary = await this.itineraries
      .findOne({ _id: id, ...(await this.visibleFilter()) })
      .lean()
      .exec();
    if (!itinerary) throw new NotFoundException('Public itinerary not found');
    return itinerary;
  }

  private async visibleFilter(): Promise<QueryFilter<Itinerary>> {
    const deactivated = await this.users
      .find({ status: UserStatus.DEACTIVATED })
      .distinct('_id')
      .exec();
    return {
      visibility: ItineraryVisibility.PUBLIC,
      hiddenAt: null,
      userId: { $nin: deactivated },
    };
  }

  private async authorNames(
    ids: Types.ObjectId[],
  ): Promise<Map<string, string>> {
    const rows = await this.users
      .find({ _id: { $in: ids } }, { name: 1 })
      .lean()
      .exec();
    return new Map(rows.map((u) => [u._id.toString(), u.name]));
  }
}

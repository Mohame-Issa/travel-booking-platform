import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { type Connection, Model, Types } from 'mongoose';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { City } from '../seed/schemas/reference-data.schema.js';
import { UploadsService } from '../uploads/uploads.service.js';
import type { AddDayDto, ReorderDayDto, UpdateDayDto } from './dto/day.dto.js';
import { Activity } from './schemas/activity.schema.js';
import { BudgetEntry } from './schemas/budget-entry.schema.js';
import { ItineraryDay } from './schemas/itinerary-day.schema.js';
import { Itinerary } from './schemas/itinerary.schema.js';
import { TransportCost } from './schemas/transport-cost.schema.js';

/** ITN-05: an itinerary has at most 60 days. */
export const MAX_DAYS = 60;

/**
 * Days of an itinerary (ITN-05, ITN-07, ITN-08, ITN-09).
 *
 * Day numbers are always 1..n with no gaps. Every change that renumbers runs
 * in a transaction together with Itinerary.dayCount, so two requests at the
 * same time cannot create duplicate numbers or a 61st day.
 * Dates are never stored (startDate + dayNumber - 1), so renumbering is all
 * it takes to "recalculate the dates" (ITN-07, ITN-08).
 */
@Injectable()
export class ItineraryDaysService {
  constructor(
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    @InjectModel(ItineraryDay.name) private readonly days: Model<ItineraryDay>,
    @InjectModel(Activity.name) private readonly activities: Model<Activity>,
    @InjectModel(BudgetEntry.name) private readonly budgets: Model<BudgetEntry>,
    @InjectModel(TransportCost.name)
    private readonly transport: Model<TransportCost>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectConnection() private readonly connection: Connection,
    private readonly uploads: UploadsService,
  ) {}

  /** POST /api/itineraries/:id/days: adds a day at the end (ITN-05). */
  async add(itineraryId: string, dto: AddDayDto) {
    await this.assertCity(dto.cityId);
    return this.connection.transaction(async (session) => {
      // Reserve the next number atomically; fails at 60 days (ITN-05).
      const itinerary = await this.itineraries
        .findOneAndUpdate(
          { _id: itineraryId, dayCount: { $lt: MAX_DAYS } },
          { $inc: { dayCount: 1 } },
          { new: true, session },
        )
        .exec();
      if (!itinerary) {
        const exists = await this.itineraries
          .exists({ _id: itineraryId })
          .session(session);
        if (!exists) throw new NotFoundException('Itinerary not found');
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.ITINERARY_DAY_LIMIT,
          `An itinerary has at most ${MAX_DAYS} days (ITN-05)`,
        );
      }
      const [day] = await this.days.create(
        [
          {
            itineraryId: itinerary._id,
            userId: itinerary.userId,
            dayNumber: itinerary.dayCount,
            cityId: dto.cityId,
            notes: dto.notes ?? '',
          },
        ],
        { session },
      );
      return day;
    });
  }

  /** PATCH /api/itineraries/:id/days/:dayId: city and notes (ITN-05). */
  async update(itineraryId: string, dayId: string, dto: UpdateDayDto) {
    if (dto.cityId !== undefined) await this.assertCity(dto.cityId);
    const set: Partial<ItineraryDay> = {};
    if (dto.cityId !== undefined) set.cityId = dto.cityId;
    if (dto.notes !== undefined) set.notes = dto.notes;
    const day = await this.days
      .findOneAndUpdate(
        { _id: dayId, itineraryId },
        { $set: set },
        { new: true },
      )
      .exec();
    if (!day) throw new NotFoundException('Day not found in this itinerary');
    await this.touch(itineraryId);
    return day;
  }

  /**
   * DELETE /api/itineraries/:id/days/:dayId (ITN-07). Deletes the day with its
   * activities, budget entries and transport costs, and renumbers the later
   * days. Budget totals are computed when read, so they follow automatically.
   */
  async remove(itineraryId: string, dayId: string): Promise<void> {
    const activityIds = await this.activities
      .find({ dayId })
      .distinct('_id')
      .exec();
    await this.connection.transaction(async (session) => {
      const day = await this.days
        .findOneAndDelete({ _id: dayId, itineraryId }, { session })
        .exec();
      if (!day) throw new NotFoundException('Day not found in this itinerary');
      await this.activities.deleteMany({ dayId: day._id }, { session }).exec();
      await this.budgets.deleteMany({ dayId: day._id }, { session }).exec();
      await this.transport.deleteMany({ dayId: day._id }, { session }).exec();
      await this.days
        .updateMany(
          { itineraryId: day.itineraryId, dayNumber: { $gt: day.dayNumber } },
          { $inc: { dayNumber: -1 } },
          { session },
        )
        .exec();
      await this.itineraries
        .updateOne(
          { _id: day.itineraryId },
          { $inc: { dayCount: -1 } },
          { session },
        )
        .exec();
    });
    // GEN-08: the deleted activities' images go back to the uploader.
    for (const id of activityIds) {
      await this.uploads.detachOwner({ type: 'activity', id: String(id) });
    }
  }

  /**
   * PATCH /api/itineraries/:id/days/reorder (ITN-08): moves one day to a new
   * position and renumbers the others. Its activities and budgets stay with it.
   */
  async reorder(itineraryId: string, dto: ReorderDayDto): Promise<void> {
    await this.connection.transaction(async (session) => {
      const days = await this.days
        .find({ itineraryId }, { _id: 1, dayNumber: 1 })
        .sort({ dayNumber: 1 })
        .session(session)
        .exec();
      const from = days.findIndex((d) => d._id.toString() === dto.dayId);
      if (from === -1)
        throw new NotFoundException('Day not found in this itinerary');
      if (dto.position > days.length) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          'Validation failed',
          [
            {
              field: 'position',
              messages: [`position must be between 1 and ${days.length}`],
            },
          ],
        );
      }
      const [moved] = days.splice(from, 1);
      days.splice(dto.position - 1, 0, moved);
      const ops = days
        .map((d, index) => ({ d, dayNumber: index + 1 }))
        .filter(({ d, dayNumber }) => d.dayNumber !== dayNumber)
        .map(({ d, dayNumber }) => ({
          updateOne: {
            filter: { _id: d._id },
            update: { $set: { dayNumber } },
          },
        }));
      if (ops.length > 0) await this.days.bulkWrite(ops, { session });
      await this.itineraries
        .updateOne(
          { _id: itineraryId },
          { $set: { updatedAt: new Date() } },
          { session },
        )
        .exec();
    });
  }

  /** Throws 404 unless the day belongs to the itinerary. */
  async findInItinerary(itineraryId: string, dayId: string) {
    const day = await this.days.findOne({ _id: dayId, itineraryId }).exec();
    if (!day) throw new NotFoundException('Day not found in this itinerary');
    return day;
  }

  /** ITN-03: changes to days count as an update of the itinerary. */
  async touch(itineraryId: string | Types.ObjectId): Promise<void> {
    await this.itineraries
      .updateOne({ _id: itineraryId }, { $set: { updatedAt: new Date() } })
      .exec();
  }

  /** ITN-05: the city comes from the predefined list shared with hotels and airports. */
  private async assertCity(cityId: string): Promise<void> {
    if (!(await this.cities.exists({ _id: cityId }))) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.UNKNOWN_CITY,
        `Unknown city: ${cityId}`,
        [{ field: 'cityId', messages: ['not in the city list'] }],
      );
    }
  }
}

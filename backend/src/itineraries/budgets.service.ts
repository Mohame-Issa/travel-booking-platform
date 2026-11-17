import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PLATFORM_CURRENCY } from '../common/constants/currencies.js';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { City } from '../seed/schemas/reference-data.schema.js';
import { UsersService } from '../users/users.service.js';
import { buildCityGroups } from './city-groups.js';
import type {
  BudgetEntryDto,
  BudgetSummaryDto,
  CategoryTotalsDto,
  CreateBudgetEntryDto,
  CreateTransportCostDto,
  TransportCostDto,
  UpdateBudgetEntryDto,
  UpdateTransportCostDto,
} from './dto/budget.dto.js';
import { convert, ExchangeRatesService } from './exchange-rates.service.js';
import { dayDate } from './itinerary-dates.js';
import { ItineraryDaysService } from './itinerary-days.service.js';
import { Activity } from './schemas/activity.schema.js';
import { BudgetEntry } from './schemas/budget-entry.schema.js';
import { ItineraryDay } from './schemas/itinerary-day.schema.js';
import { Itinerary } from './schemas/itinerary.schema.js';
import { TransportCost } from './schemas/transport-cost.schema.js';

/**
 * Budget entries (ITN-14), intercity transport costs (ITN-16) and the budget
 * summary converted to one currency (ITN-14, ITN-18, ITN-09 group subtotals).
 * Totals are computed on every read, so adding/deleting/moving days (ITN-07,
 * ITN-08) can never leave a stale total.
 */
@Injectable()
export class BudgetsService {
  constructor(
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    @InjectModel(ItineraryDay.name)
    private readonly daysModel: Model<ItineraryDay>,
    @InjectModel(BudgetEntry.name) private readonly budgets: Model<BudgetEntry>,
    @InjectModel(TransportCost.name)
    private readonly transport: Model<TransportCost>,
    @InjectModel(Activity.name) private readonly activities: Model<Activity>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    private readonly days: ItineraryDaysService,
    private readonly fx: ExchangeRatesService,
    private readonly users: UsersService,
  ) {}

  // ---------------------------------------------------------- budget entries

  async createEntry(
    itineraryId: string,
    dayId: string,
    dto: CreateBudgetEntryDto,
  ): Promise<BudgetEntryDto> {
    const day = await this.days.findInItinerary(itineraryId, dayId);
    const entry = await this.budgets.create({
      itineraryId: day.itineraryId,
      dayId: day._id,
      userId: day.userId,
      category: dto.category,
      amount: dto.amount,
      currency: dto.currency,
      note: dto.note ?? '',
    });
    await this.days.touch(day.itineraryId);
    return toEntryDto(entry);
  }

  async updateEntry(
    id: string,
    dto: UpdateBudgetEntryDto,
  ): Promise<BudgetEntryDto> {
    const set: Partial<BudgetEntry> = {};
    if (dto.category !== undefined) set.category = dto.category;
    if (dto.amount !== undefined) set.amount = dto.amount;
    if (dto.currency !== undefined) set.currency = dto.currency;
    if (dto.note !== undefined) set.note = dto.note;
    const entry = await this.budgets
      .findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: true })
      .exec();
    if (!entry) throw new NotFoundException('Budget entry not found');
    await this.days.touch(entry.itineraryId);
    return toEntryDto(entry);
  }

  async removeEntry(id: string): Promise<void> {
    const entry = await this.budgets.findByIdAndDelete(id).exec();
    if (!entry) throw new NotFoundException('Budget entry not found');
    await this.days.touch(entry.itineraryId);
  }

  // --------------------------------------------------------- transport costs

  async createTransport(
    itineraryId: string,
    dto: CreateTransportCostDto,
  ): Promise<TransportCostDto> {
    const day = await this.days.findInItinerary(itineraryId, dto.dayId);
    await this.assertCities([dto.fromCityId, dto.toCityId]);
    const cost = await this.transport.create({
      itineraryId: day.itineraryId,
      dayId: day._id,
      userId: day.userId,
      mode: dto.mode,
      fromCityId: dto.fromCityId,
      toCityId: dto.toCityId,
      amount: dto.amount,
      currency: dto.currency,
    });
    await this.days.touch(day.itineraryId);
    return toTransportDto(cost);
  }

  async updateTransport(
    id: string,
    dto: UpdateTransportCostDto,
  ): Promise<TransportCostDto> {
    const cost = await this.transport.findById(id).exec();
    if (!cost) throw new NotFoundException('Transport cost not found');
    if (dto.dayId !== undefined) {
      // must stay inside the same itinerary
      const day = await this.days.findInItinerary(
        cost.itineraryId.toString(),
        dto.dayId,
      );
      cost.dayId = day._id;
    }
    const cities = [dto.fromCityId, dto.toCityId].filter(
      (c): c is string => c !== undefined,
    );
    if (cities.length > 0) await this.assertCities(cities);
    if (dto.mode !== undefined) cost.mode = dto.mode;
    if (dto.fromCityId !== undefined) cost.fromCityId = dto.fromCityId;
    if (dto.toCityId !== undefined) cost.toCityId = dto.toCityId;
    if (dto.amount !== undefined) cost.amount = dto.amount;
    if (dto.currency !== undefined) cost.currency = dto.currency;
    await cost.save();
    await this.days.touch(cost.itineraryId);
    return toTransportDto(cost);
  }

  async removeTransport(id: string): Promise<void> {
    const cost = await this.transport.findByIdAndDelete(id).exec();
    if (!cost) throw new NotFoundException('Transport cost not found');
    await this.days.touch(cost.itineraryId);
  }

  // ------------------------------------------------------------------ summary

  /**
   * GET /api/itineraries/:id/budget-summary (ITN-14, ITN-18, ITN-09).
   * Every amount is converted to ONE display currency: the query parameter,
   * else the user's preferred currency (ACC-09), else EGP. Booking prices are
   * not part of this, so PAY-04 is untouched.
   */
  async summary(
    itineraryId: string,
    userId: string | null,
    wanted?: string,
  ): Promise<BudgetSummaryDto> {
    const itinerary = await this.itineraries
      .findById(itineraryId)
      .lean()
      .exec();
    if (!itinerary) throw new NotFoundException('Itinerary not found');
    const preferred = userId
      ? (await this.users.findById(userId))?.preferredCurrency
      : null;
    const currency = wanted ?? preferred ?? PLATFORM_CURRENCY;

    const id = new Types.ObjectId(itineraryId);
    const [days, entries, acts, trips] = await Promise.all([
      this.daysModel
        .find({ itineraryId: id })
        .sort({ dayNumber: 1 })
        .lean()
        .exec(),
      this.budgets.find({ itineraryId: id }).lean().exec(),
      this.activities
        .find({ itineraryId: id, cost: { $ne: null } })
        .lean()
        .exec(),
      this.transport.find({ itineraryId: id }).lean().exec(),
    ]);

    // Only call the exchange-rate service if something is in another currency.
    const used = [...entries, ...acts, ...trips].map(
      (x) => x.currency as string,
    );
    const needsRates = used.some((c) => c !== currency);
    const table = needsRates ? await this.fx.getRates() : null;
    const toTarget = (amount: number, from: string) =>
      table ? convert(amount, from, currency, table.rates) : amount;

    const perDay = new Map<string, CategoryTotalsDto>(
      days.map((d) => [d._id.toString(), zero()]),
    );
    for (const e of entries)
      perDay.get(e.dayId.toString())![e.category] += toTarget(
        e.amount,
        e.currency,
      );
    // ITN-14: activity costs count under "activities".
    for (const a of acts)
      perDay.get(a.dayId.toString())!.activities += toTarget(
        a.cost!,
        a.currency!,
      );
    for (const t of trips)
      perDay.get(t.dayId.toString())!.intercity_transport += toTarget(
        t.amount,
        t.currency,
      );

    const byDay = days.map((d) => {
      const byCategory = roundAll(perDay.get(d._id.toString())!);
      return {
        dayNumber: d.dayNumber,
        date: dayDate(itinerary.startDate, d.dayNumber),
        cityId: d.cityId,
        total: sum(byCategory),
        byCategory,
      };
    });
    const byCategory = roundAll(
      [...perDay.values()].reduce((acc, c) => {
        for (const k of KEYS) acc[k] += c[k];
        return acc;
      }, zero()),
    );
    const byGroup = buildCityGroups(itinerary.startDate, days).map((g) => ({
      cityId: g.cityId,
      firstDayNumber: g.firstDayNumber,
      lastDayNumber: g.lastDayNumber,
      dayCount: g.dayCount,
      subtotal: round2(
        byDay
          .filter(
            (d) =>
              d.dayNumber >= g.firstDayNumber && d.dayNumber <= g.lastDayNumber,
          )
          .reduce((s, d) => s + d.total, 0),
      ),
    }));

    return {
      currency,
      rateDate: table?.rateDate ?? null,
      ratesAreLatest: table?.isLatest ?? true,
      total: sum(byCategory),
      byCategory,
      byDay,
      byGroup,
    };
  }

  private async assertCities(ids: string[]): Promise<void> {
    const found = await this.cities
      .find({ _id: { $in: ids } })
      .distinct('_id')
      .exec();
    const missing = ids.filter((c) => !found.includes(c));
    if (missing.length > 0) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.UNKNOWN_CITY,
        `Unknown city: ${missing.join(', ')}`,
      );
    }
  }
}

const KEYS = [
  'food',
  'accommodation',
  'in_city_transport',
  'activities',
  'intercity_transport',
] as const;
const zero = (): CategoryTotalsDto => ({
  food: 0,
  accommodation: 0,
  in_city_transport: 0,
  activities: 0,
  intercity_transport: 0,
});
const round2 = (n: number) => Math.round(n * 100) / 100;
function roundAll(c: CategoryTotalsDto): CategoryTotalsDto {
  const out = zero();
  for (const k of KEYS) out[k] = round2(c[k]);
  return out;
}
const sum = (c: CategoryTotalsDto) =>
  round2(KEYS.reduce((s, k) => s + c[k], 0));

export function toEntryDto(
  e: BudgetEntry & { _id: Types.ObjectId },
): BudgetEntryDto {
  return {
    id: e._id.toString(),
    dayId: e.dayId.toString(),
    category: e.category,
    amount: e.amount,
    currency: e.currency,
    note: e.note,
  };
}

export function toTransportDto(
  t: TransportCost & { _id: Types.ObjectId },
): TransportCostDto {
  return {
    id: t._id.toString(),
    dayId: t.dayId.toString(),
    mode: t.mode,
    fromCityId: t.fromCityId,
    toCityId: t.toCityId,
    amount: t.amount,
    currency: t.currency,
  };
}

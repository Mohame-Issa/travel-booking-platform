import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type PipelineStage, Types } from 'mongoose';
import { Airline } from '../airlines/schemas/airline.schema.js';
import { PLATFORM_CURRENCY } from '../common/constants/currencies.js';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { BookingStatus } from '../common/interfaces/index.js';
import { paginateArray } from '../common/utils/paginate.js';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema.js';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema.js';
import { Hotel } from '../hotels/schemas/hotel.schema.js';
import { fromMinorUnits } from '../payments/money.util.js';
import { Refund } from '../refunds/schemas/refund.schema.js';
import type {
  AnalyticsFiguresDto,
  AnalyticsQueryDto,
  AnalyticsResponseDto,
  ProviderAnalyticsDto,
} from './dto/analytics.dto.js';

const DAY_MS = 86_400_000;
/** Default period when none is given: the last 30 days. */
const DEFAULT_DAYS = 30;
/** Refunds that give booking money back because it was cancelled (PAY-03). */
const CANCELLATION_REASONS = [
  'user_cancellation',
  'provider_cancellation',
  'flight_cancelled',
];

interface Group {
  _id: Types.ObjectId;
  bookings: number;
  cancelled: number;
  gross: number;
  refundsMinor: number;
}

/**
 * BON-01 (bonus): admin analytics, bookings and revenue per provider over a
 * selected period. Added by Youssef Khafagy. Read-only aggregations over the
 * flight bookings (Omar Hashem), hotel reservations (Mohamed Hashad) and
 * refunds (Youssef). Nothing is stored, so the figures are always current.
 *
 * Definitions (the requirement gives none, so these are ours):
 *  - a booking counts in the period in which it was CONFIRMED (paid);
 *    pending or expired holds never count;
 *  - gross revenue = the bookings' totals (after any FLT-27 change);
 *  - refunds = cancellation refunds on those bookings that did not fail;
 *  - net revenue = gross - refunds. All in EGP (PAY-04).
 */
@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly flights: Model<FlightBooking>,
    @InjectModel(HotelBooking.name)
    private readonly hotelBookings: Model<HotelBooking>,
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
  ) {}

  async dashboard(q: AnalyticsQueryDto): Promise<AnalyticsResponseDto> {
    const { from, to, start, end } = period(q.from, q.to);
    const rows: ProviderAnalyticsDto[] = [];
    if (q.providerType !== 'hotel') {
      const groups = await this.flights.aggregate<Group>(
        this.pipeline('flight', '$airlineId', start, end),
      );
      const names = await this.names(this.airlines, groups);
      rows.push(...groups.map((g) => toRow('airline', g, names)));
    }
    if (q.providerType !== 'airline') {
      const groups = await this.hotelBookings.aggregate<Group>(
        this.pipeline('hotel', '$hotelId', start, end),
      );
      const names = await this.names(this.hotels, groups);
      rows.push(...groups.map((g) => toRow('hotel', g, names)));
    }
    rows.sort((a, b) => b.netRevenue - a.netRevenue || b.bookings - a.bookings);
    const page = paginateArray(rows, q.page);
    return {
      from,
      to,
      currency: PLATFORM_CURRENCY,
      totals: sum(rows),
      items: page.items,
      meta: page.meta,
    };
  }

  /** One aggregation per booking collection: group the period's bookings by provider. */
  private pipeline(
    bookingType: 'flight' | 'hotel',
    providerField: string,
    start: Date,
    end: Date,
  ): PipelineStage[] {
    return [
      { $match: { confirmedAt: { $gte: start, $lt: end } } },
      {
        $lookup: {
          from: this.refunds.collection.name,
          let: { bookingId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$bookingId', '$$bookingId'] },
                bookingType,
                reason: { $in: CANCELLATION_REASONS },
                status: { $ne: 'failed' },
              },
            },
            { $group: { _id: null, minor: { $sum: '$amountMinor' } } },
          ],
          as: 'refund',
        },
      },
      {
        $group: {
          _id: providerField,
          bookings: { $sum: 1 },
          cancelled: {
            $sum: {
              $cond: [{ $eq: ['$status', BookingStatus.CANCELLED] }, 1, 0],
            },
          },
          gross: { $sum: '$totalAmount' },
          refundsMinor: { $sum: { $ifNull: [{ $first: '$refund.minor' }, 0] } },
        },
      },
    ];
  }

  private async names(
    model: Model<Airline> | Model<Hotel>,
    groups: Group[],
  ): Promise<Map<string, string>> {
    const rows = await (model as unknown as Model<{ name: string }>)
      .find({ _id: { $in: groups.map((g) => g._id) } }, { name: 1 })
      .lean()
      .exec();
    return new Map(rows.map((r) => [String(r._id), r.name]));
  }
}

/** YYYY-MM-DD strings to a [start, end) range in UTC; "to" is included. */
function period(fromText?: string, toText?: string) {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const to = toText ?? day(new Date());
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const from =
    fromText ?? day(new Date(toDate.getTime() - (DEFAULT_DAYS - 1) * DAY_MS));
  const start = new Date(`${from}T00:00:00.000Z`);
  if (start > toDate)
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.INVALID_DATE_RANGE,
      '"from" must be on or before "to"',
      [{ field: 'from', messages: ['"from" must be on or before "to"'] }],
    );
  return { from, to, start, end: new Date(toDate.getTime() + DAY_MS) };
}

const money = (n: number) => Math.round(n * 100) / 100;

function toRow(
  providerType: 'airline' | 'hotel',
  g: Group,
  names: Map<string, string>,
): ProviderAnalyticsDto {
  const grossRevenue = money(g.gross);
  const refunds = fromMinorUnits(g.refundsMinor, PLATFORM_CURRENCY);
  return {
    providerType,
    providerId: String(g._id),
    name: names.get(String(g._id)) ?? '(deleted provider)',
    bookings: g.bookings,
    cancelled: g.cancelled,
    grossRevenue,
    refunds,
    netRevenue: money(grossRevenue - refunds),
  };
}

function sum(rows: AnalyticsFiguresDto[]): AnalyticsFiguresDto {
  const t = {
    bookings: 0,
    cancelled: 0,
    grossRevenue: 0,
    refunds: 0,
    netRevenue: 0,
  };
  for (const r of rows) {
    t.bookings += r.bookings;
    t.cancelled += r.cancelled;
    t.grossRevenue = money(t.grossRevenue + r.grossRevenue);
    t.refunds = money(t.refunds + r.refunds);
    t.netRevenue = money(t.netRevenue + r.netRevenue);
  }
  return t;
}

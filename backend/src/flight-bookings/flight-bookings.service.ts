import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ModuleRef } from '@nestjs/core';
import {
  Model,
  Types,
  type ClientSession,
  type Connection,
  type QueryFilter,
} from 'mongoose';
import PDFDocument from 'pdfkit';
import {
  Airline,
  AirlinePolicy,
  Airport,
  ApiException,
  BookingStatus,
  CabinClass,
  CabinInventory,
  ErrorCode,
  Flight,
  FlightStatus,
  ModeratorAssignmentsService,
  NOTIFICATION_SERVICE,
  ProviderType,
  REFUND_PREVIEW_SERVICE,
  REFUND_SERVICE,
  UserRole,
  paginate,
  type AuthenticatedUser,
  type BookingLifecycleService,
  type BookingPaymentReader,
  type BookingPaymentSnapshot,
  type ConfirmBookingInput,
  type FlightEventPayload,
  type NotificationService,
  type RefundPreview,
  type RefundPreviewService,
  type RefundService,
  type ReleaseInventoryInput,
  type UpcomingConfirmedBookingsChecker,
  type FlightBookingHistoryReader,
} from './flight-bookings.imports.js';

import { PLATFORM_CURRENCY } from '../common/constants/currencies.js'; // PAY-04
import {
  FlightBooking,
  type FlightBookingDocument,
} from './schemas/flight-booking.schema.js';
import {
  BookingRequestDto,
  FlightBookingsQueryDto,
  ListMyBookingsQueryDto,
} from './dto/flight-booking.dto.js';
import {
  formatLocal,
  generateBookingReference,
  round2,
  toCsv,
  type CsvValue,
} from './flight-bookings.utils.js';
import type { ChangeSeatsDto } from './dto/seat.dto.js';
import { SeatsService } from './seats.service.js';
import {
  CHANGE_AS_BOOKING_STATUS,
  FlightChangesService,
} from './flight-changes.service.js';
export const HOLD_MINUTES = 10; // FLT-22
const MAX_ACTIVE_HOLDS_PER_USER = 3; // stops one user from hoarding seats

@Injectable()
export class FlightBookingsService
  implements
    BookingLifecycleService,
    UpcomingConfirmedBookingsChecker,
    BookingPaymentReader,
    FlightBookingHistoryReader
{
  private readonly logger = new Logger(FlightBookingsService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(CabinInventory.name)
    private readonly cabins: Model<CabinInventory>,
    @InjectModel(AirlinePolicy.name)
    private readonly policies: Model<AirlinePolicy>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(NOTIFICATION_SERVICE)
    private readonly notifications: NotificationService,
    private readonly moduleRef: ModuleRef,
    private readonly moderators: ModeratorAssignmentsService,
    private readonly seats: SeatsService, // FLT-28 (bonus, Youssef Khafagy)
    private readonly changes: FlightChangesService, // FLT-27 (bonus, Youssef Khafagy)
  ) {}

  // Resolved lazily (at call time) to avoid a circular dependency with Youssef's refunds module.
  private get refunds(): RefundService {
    return this.moduleRef.get<RefundService>(REFUND_SERVICE, { strict: false });
  }
  private get refundPreviews(): RefundPreviewService {
    return this.moduleRef.get<RefundPreviewService>(REFUND_PREVIEW_SERVICE, {
      strict: false,
    });
  }

  // ------------------------------------------------------------------ helpers

  private async inTransaction<T>(
    work: (s: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let result!: T;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  private async timeZones(codes: string[]): Promise<Map<string, string>> {
    // Assumes the Airport _id is the IATA code and the field is `timeZone`; adjust if Yassin's schema differs.
    const rows = await this.airports.find({ _id: { $in: codes } }).lean();
    return new Map(rows.map((a) => [String(a._id), a.timeZone]));
  }

  // -------------------------------------------- FLT-19 / FLT-21: price + validate

  private async quote(dto: BookingRequestDto) {
    const seats = dto.passengers.length;
    const flight = await this.flights.findById(dto.flightId).lean();
    if (!flight) throw new NotFoundException('Flight not found');
    // FLT-30: only Scheduled flights that have not departed are bookable
    if (
      flight.status !== FlightStatus.SCHEDULED ||
      flight.departureTime <= new Date()
    )
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.FLIGHT_NOT_BOOKABLE,
        'This flight cannot be booked',
      );

    const airline = await this.airlines.findById(flight.airlineId).lean();
    // Yassin's airline "active/deactivated" status; adjust the field name if it differs.
    if (!airline || airline.status !== 'active')
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.AIRLINE_INACTIVE,
        'This airline is not accepting bookings',
      );

    const cabin = await this.cabins
      .findOne({ flightId: flight._id, cabinClass: dto.cabinClass })
      .lean();
    if (!cabin)
      throw new NotFoundException(`This flight has no ${dto.cabinClass} cabin`);
    if (cabin.seatCount - cabin.bookedSeats - cabin.heldSeats < seats)
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.SEATS_UNAVAILABLE,
        'Not enough seats left in this cabin',
      );

    // FLT-08: extra bags only if the airline set a price
    const policy = await this.policies
      .findOne({ airlineId: flight.airlineId })
      .lean();
    const bagPrice = policy?.extraBagPrice ?? 0;
    const maxBags = policy?.extraBagPrice ? policy.maxExtraBags : 0;

    const seen = new Set<string>();
    const passengers = dto.passengers.map((p) => {
      const passportNumber = p.passportNumber.toUpperCase();
      if (seen.has(passportNumber))
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.INVALID_PASSENGERS,
          `Duplicate passport/ID: ${passportNumber}`,
        );
      seen.add(passportNumber);
      if (new Date(p.dateOfBirth) > new Date())
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.INVALID_PASSENGERS,
          `Date of birth is in the future: ${p.fullName}`,
        );
      const extraBags = p.extraBags ?? 0;
      if (extraBags > maxBags)
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.INVALID_PASSENGERS,
          `${p.fullName}: at most ${maxBags} extra bag(s) allowed by this airline`,
        );
      return {
        fullName: p.fullName,
        dateOfBirth: new Date(p.dateOfBirth),
        passportNumber,
        extraBags,
        baggageFee: round2(extraBags * bagPrice),
        ...(p.seatNumber ? { seatNumber: p.seatNumber } : {}),
      };
    });
    // FLT-28 (bonus): chosen seats must exist in this cabin and be free.
    await this.seats.checkChoices(
      flight._id,
      dto.cabinClass,
      cabin.seatCount,
      dto.passengers,
    );
    const baggageTotal = round2(
      passengers.reduce((s, p) => s + p.baggageFee, 0),
    );
    return { flight, airline, cabin, passengers, seats, baggageTotal };
  }

  private async toSummary(
    q: Awaited<ReturnType<FlightBookingsService['quote']>>,
    pricePerSeat: number,
  ) {
    const zones = await this.timeZones([
      q.flight.departureAirport,
      q.flight.arrivalAirport,
    ]);
    const dz = zones.get(q.flight.departureAirport);
    const az = zones.get(q.flight.arrivalAirport);
    return {
      flightNumber: q.flight.flightNumber,
      from: q.flight.departureAirport,
      to: q.flight.arrivalAirport,
      departureLocal: dz
        ? formatLocal(q.flight.departureTime, dz)
        : q.flight.departureTime,
      arrivalLocal: az
        ? formatLocal(q.flight.arrivalTime, az)
        : q.flight.arrivalTime,
      cabinClass: q.cabin.cabinClass,
      passengers: q.passengers,
      pricePerSeat,
      baggageTotal: q.baggageTotal,
      totalAmount: round2(pricePerSeat * q.seats + q.baggageTotal),
      currency: PLATFORM_CURRENCY,
    };
  }

  /** POST /flight-bookings : summary only, reserves nothing. */
  async summary(dto: BookingRequestDto) {
    const q = await this.quote(dto);
    return this.toSummary(q, q.cabin.price);
  }

  // ------------------------------------------------------ FLT-22: atomic hold

  /** POST /flight-bookings/hold */
  async hold(userId: string, dto: BookingRequestDto) {
    const q = await this.quote(dto);
    const active = await this.bookings.countDocuments({
      userId,
      status: BookingStatus.PENDING_PAYMENT,
      holdExpiresAt: { $gt: new Date() },
    });
    if (active >= MAX_ACTIVE_HOLDS_PER_USER)
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.TOO_MANY_HOLDS,
        'You already have active seat holds. Pay for one or wait for it to expire.',
      );

    const booking = await this.inTransaction(async (session) => {
      // (1) flight must still be Scheduled. The $inc touches the flight so a simultaneous
      //     cancel/schedule change conflicts with this transaction (Yassin's inventoryRevision).
      const flight = await this.flights.findOneAndUpdate(
        {
          _id: q.flight._id,
          status: FlightStatus.SCHEDULED,
          departureTime: { $gt: new Date() },
        },
        { $inc: { bookingCount: 1, inventoryRevision: 1 } },
        { session, returnDocument: 'after' },
      );
      if (!flight)
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.FLIGHT_NOT_BOOKABLE,
          'This flight cannot be booked',
        );

      // (2) ONE atomic update: the filter checks capacity, the $inc reserves it.
      //     Two simultaneous requests can never both get the last seat.
      const cabin = await this.cabins.findOneAndUpdate(
        {
          flightId: flight._id,
          cabinClass: dto.cabinClass,
          $expr: {
            $lte: [
              { $add: ['$bookedSeats', '$heldSeats', q.seats] },
              '$seatCount',
            ],
          },
        },
        { $inc: { heldSeats: q.seats } },
        { session, returnDocument: 'after' },
      );
      if (!cabin)
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.SEATS_UNAVAILABLE,
          'Not enough seats left in this cabin',
        );

      // (3) FLT-28 (bonus): a seat for every passenger, chosen or first free.
      const bookingId = new Types.ObjectId();
      const seatOf = await this.seats.assign(session, {
        flightId: flight._id,
        cabinClass: dto.cabinClass,
        ownerId: bookingId,
        requests: q.passengers,
      });

      // (4) Pending Payment booking, held for 10 minutes. Price is a snapshot.
      const [created] = await this.bookings.create(
        [
          {
            _id: bookingId,
            userId,
            flightId: flight._id,
            airlineId: flight.airlineId,
            cabinClass: dto.cabinClass,
            seatCount: q.seats,
            passengers: q.passengers.map((p) => ({
              ...p,
              seatNumber: seatOf.get(p.passportNumber),
            })),
            flightNumber: flight.flightNumber,
            departureAirport: flight.departureAirport,
            arrivalAirport: flight.arrivalAirport,
            departureTime: flight.departureTime,
            arrivalTime: flight.arrivalTime,
            pricePerSeat: cabin.price,
            baggageTotal: q.baggageTotal,
            totalAmount: round2(cabin.price * q.seats + q.baggageTotal),
            currency: PLATFORM_CURRENCY,
            status: BookingStatus.PENDING_PAYMENT,
            holdExpiresAt: new Date(Date.now() + HOLD_MINUTES * 60_000),
          },
        ],
        { session },
      );
      return created;
    });
    return {
      bookingId: String(booking._id),
      status: booking.status,
      holdExpiresAt: booking.holdExpiresAt,
      ...(await this.toSummary(q, booking.pricePerSeat)),
      totalAmount: booking.totalAmount,
    };
  }

  // --------------------------- called by Youssef (token FLIGHT_BOOKING_LIFECYCLE)

  /** Pending Payment -> Confirmed after the webhook verified payment (FLT-23). Idempotent. */
  async confirmBooking({
    bookingId,
    paymentId,
  }: ConfirmBookingInput): Promise<void> {
    const existing = await this.bookings.findById(bookingId).lean();
    if (!existing) {
      // FLT-27: the payment was for the fare difference of a flight change.
      if (await this.changes.isChange(bookingId))
        return this.changes.confirmChange({ bookingId, paymentId });
      throw new NotFoundException('Flight booking not found');
    }
    if (
      existing.status === BookingStatus.CONFIRMED &&
      existing.paymentId === paymentId
    )
      return; // webhook retry

    let confirmed: FlightBookingDocument | null = null;
    for (let attempt = 0; attempt < 5 && !confirmed; attempt++) {
      try {
        confirmed = await this.inTransaction(async (session) => {
          const b = await this.bookings.findOneAndUpdate(
            {
              _id: bookingId,
              status: BookingStatus.PENDING_PAYMENT,
              holdExpiresAt: { $gt: new Date() },
            },
            {
              status: BookingStatus.CONFIRMED,
              reference: generateBookingReference(),
              paymentId,
              confirmedAt: new Date(),
              holdExpiresAt: null,
            },
            { session, returnDocument: 'after' },
          );
          if (!b) return null;
          // held seats -> booked seats
          await this.cabins.updateOne(
            { flightId: b.flightId, cabinClass: b.cabinClass },
            { $inc: { heldSeats: -b.seatCount, bookedSeats: b.seatCount } },
            { session },
          );
          return b;
        });
        if (!confirmed) break;
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e; // reference collision: retry
      }
    }
    if (!confirmed)
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.HOLD_EXPIRED,
        'Booking cannot be confirmed (hold expired or wrong status)',
      );

    await this.safeNotify(() =>
      this.notifications.notify({
        userId: String(confirmed!.userId),
        type: 'booking_confirmed',
        title: 'Flight booking confirmed',
        message: `Your booking ${confirmed!.reference} is confirmed. You can download your e-ticket.`,
        data: { bookingType: 'flight', bookingId },
      }),
    );
  }

  /** Gives seats back. Idempotent. Pending -> Expired; Confirmed + 'cancelled' -> Cancelled. */
  async releaseInventory({
    bookingId,
    reason,
  }: ReleaseInventoryInput): Promise<void> {
    const b = await this.bookings.findById(bookingId).lean();
    if (!b) {
      // FLT-27: an unpaid flight change gives its held seats back.
      if (await this.changes.isChange(bookingId))
        return this.changes.releaseInventory({ bookingId, reason });
      throw new NotFoundException('Flight booking not found');
    }
    if (b.status === BookingStatus.PENDING_PAYMENT) {
      await this.inTransaction(async (session) => {
        const expired = await this.bookings.findOneAndUpdate(
          { _id: bookingId, status: BookingStatus.PENDING_PAYMENT },
          { status: BookingStatus.EXPIRED, holdExpiresAt: null },
          { session, returnDocument: 'after' },
        );
        if (!expired) return; // someone else already released/confirmed it
        await this.cabins.updateOne(
          { flightId: expired.flightId, cabinClass: expired.cabinClass },
          { $inc: { heldSeats: -expired.seatCount } },
          { session },
        );
        await this.seats.release(session, expired._id); // FLT-28
      });
    } else if (b.status === BookingStatus.CONFIRMED && reason === 'cancelled') {
      await this.cancelConfirmed({ _id: bookingId }, 'system');
    }
  }

  /** ACC-12 (token FLIGHT_UPCOMING_BOOKINGS_CHECKER). */
  async hasUpcomingConfirmedBookings(userId: string): Promise<boolean> {
    return !!(await this.bookings.exists({
      userId,
      status: BookingStatus.CONFIRMED,
      departureTime: { $gt: new Date() },
    }));
  }

  /** PAY-01/02/03 (token FLIGHT_BOOKING_PAYMENT_READER). */
  async getPaymentSnapshot(
    bookingId: string,
  ): Promise<BookingPaymentSnapshot | null> {
    const b = await this.bookings.findById(bookingId).lean();
    if (!b) {
      // FLT-27 (bonus): the "booking" paid for is a flight change; the user
      // pays only the fare difference, under the same airline's policies.
      const c = await this.changes.findById(bookingId);
      if (!c) return null;
      return {
        bookingId: String(c._id),
        userId: String(c.userId),
        status: CHANGE_AS_BOOKING_STATUS[c.status],
        totalAmount: c.amountDue,
        currency: c.currency,
        holdExpiresAt: c.holdExpiresAt,
        startsAt: c.toDepartureTime,
        policies: await this.policiesFor(
          c.airlineId,
          c.toFlightId,
          c.cabinClass,
        ),
        parentBookingId: String(c.bookingId),
      };
    }
    return {
      bookingId: String(b._id),
      userId: String(b.userId),
      status: b.status,
      totalAmount: b.totalAmount,
      currency: b.currency,
      holdExpiresAt: b.holdExpiresAt,
      startsAt: b.departureTime,
      policies: await this.policiesFor(b.airlineId, b.flightId, b.cabinClass),
    };
  }

  /** PAY-02 policies of an airline for one booked cabin (FLT-04, FLT-08, FLT-09). */
  private async policiesFor(
    airlineId: Types.ObjectId,
    flightId: Types.ObjectId,
    cabinClass: CabinClass,
  ) {
    const policy = await this.policies.findOne({ airlineId }).lean();
    const cabin = await this.cabins.findOne({ flightId, cabinClass }).lean();
    return {
      cancellationTiers: (policy?.cancellationTiers ?? []).map((t) => ({
        daysBefore: t.daysBefore,
        refundPercentage: t.refundPercentage,
      })),
      baggagePolicy: cabin
        ? {
            freeBags: cabin.freeBaggage,
            maxWeightKgPerBag: cabin.maxBagWeightKg,
            extraBagPrice: policy?.extraBagPrice ?? 0,
            maxExtraBags: policy?.maxExtraBags ?? 0,
          }
        : null,
      checkInTime: null,
      checkOutTime: null,
    };
  }

  /** Yassin's FLIGHT_BOOKING_HISTORY_READER: true if the flight EVER had a booking (any status). */
  async hasAnyBooking(
    flightId: string,
    session: ClientSession,
  ): Promise<boolean | null> {
    return !!(await this.bookings.exists({ flightId }).session(session));
  }

  // ------------------------------------------------------------ FLT-25: reading

  async list(userId: string, q: ListMyBookingsQueryDto) {
    const now = new Date();
    const filter: QueryFilter<FlightBooking> = { userId };
    let sort: Record<string, 1 | -1> = { departureTime: -1 };
    if (q.group === 'upcoming') {
      filter.status = BookingStatus.CONFIRMED;
      filter.departureTime = { $gt: now };
      sort = { departureTime: 1 };
    } else if (q.group === 'past') {
      filter.$or = [
        { status: BookingStatus.COMPLETED },
        { status: BookingStatus.CONFIRMED, departureTime: { $lte: now } },
      ];
    } else if (q.group === 'cancelled') filter.status = BookingStatus.CANCELLED;
    else filter.status = { $ne: BookingStatus.EXPIRED };
    return paginate(this.bookings, filter, { page: q.page, sort });
  }

  async getOne(user: AuthenticatedUser, id: string) {
    const b = await this.bookings.findById(id).lean();
    if (!b || (String(b.userId) !== user.id && user.role !== UserRole.ADMIN))
      throw new NotFoundException('Flight booking not found'); // do not reveal other users' bookings
    return b;
  }

  // ------------------------------------------- FLT-28 (bonus): change seats

  /**
   * PATCH /flight-bookings/:id/seats: move passengers of my Pending Payment or
   * Confirmed booking to other free seats before departure.
   */
  async changeSeats(userId: string, id: string, dto: ChangeSeatsDto) {
    return this.inTransaction(async (session) => {
      // Touching the booking serializes this with a parallel cancel or change.
      const b = await this.bookings.findOneAndUpdate(
        {
          _id: id,
          userId,
          status: {
            $in: [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED],
          },
          departureTime: { $gt: new Date() },
        },
        { $set: { updatedAt: new Date() } },
        { session, returnDocument: 'after' },
      );
      if (!b) {
        const exists = await this.bookings
          .exists({ _id: id, userId })
          .session(session);
        if (!exists) throw new NotFoundException('Flight booking not found');
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.BOOKING_NOT_CANCELLABLE,
          'Seats can only be changed on a Pending Payment or Confirmed booking before departure',
        );
      }
      const passports = new Set(b.passengers.map((p) => p.passportNumber));
      for (const s of dto.seats)
        if (!passports.has(s.passportNumber))
          throw new ApiException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.INVALID_PASSENGERS,
            `No passenger with passport/ID ${s.passportNumber} on this booking`,
          );
      const seatOf = await this.seats.reassign(session, {
        flightId: b.flightId,
        cabinClass: b.cabinClass,
        ownerId: b._id,
        requests: dto.seats,
      });
      b.passengers.forEach((p) => {
        const seat = seatOf.get(p.passportNumber);
        if (seat) p.seatNumber = seat;
      });
      await b.save({ session });
      return {
        bookingId: String(b._id),
        passengers: b.passengers.map((p) => ({
          fullName: p.fullName,
          passportNumber: p.passportNumber,
          seatNumber: p.seatNumber ?? null,
        })),
      };
    });
  }

  // ----------------------------------------------------------- FLT-23: e-ticket

  async eTicket(userId: string, id: string) {
    const b = await this.bookings.findOne({ _id: id, userId }).lean();
    if (!b) throw new NotFoundException('Flight booking not found');
    if (
      b.status !== BookingStatus.CONFIRMED &&
      b.status !== BookingStatus.COMPLETED
    )
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'E-ticket is only available for confirmed bookings',
      );
    const [zones, airline] = await Promise.all([
      this.timeZones([b.departureAirport, b.arrivalAirport]),
      this.airlines.findById(b.airlineId).lean(),
    ]);
    const local = (d: Date, code: string) =>
      zones.get(code) ? formatLocal(d, zones.get(code)!) : d.toISOString();

    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.fontSize(22).text('E-TICKET', { align: 'center' }).moveDown(0.5);
      doc
        .fontSize(14)
        .text(`Booking reference: ${b.reference}`, { align: 'center' })
        .moveDown();
      doc
        .fontSize(12)
        .text(`Airline: ${airline?.name ?? ''}`)
        .text(`Flight: ${b.flightNumber}`)
        .text(`Cabin: ${b.cabinClass}`)
        .moveDown()
        .text(
          `From: ${b.departureAirport}   Departs: ${local(b.departureTime, b.departureAirport)}`,
        )
        .text(
          `To: ${b.arrivalAirport}   Arrives: ${local(b.arrivalTime, b.arrivalAirport)}`,
        )
        .moveDown();
      doc.fontSize(13).text('Passengers').fontSize(12);
      b.passengers.forEach((p, i) =>
        doc.text(
          `${i + 1}. ${p.fullName}  |  ID/Passport: ${p.passportNumber}  |  Seat: ${p.seatNumber ?? '-'}  |  Extra bags: ${p.extraBags}`,
        ),
      );
      doc
        .moveDown()
        .text(`Total paid: ${b.totalAmount.toFixed(2)} ${b.currency}`);
      doc.end();
    });
    return { pdf, filename: `e-ticket-${b.reference}.pdf` };
  }

  // -------------------------------------------------------- FLT-26: cancelling

  private async ownedConfirmed(userId: string, id: string) {
    const b = await this.bookings.findOne({ _id: id, userId }).lean();
    if (!b) throw new NotFoundException('Flight booking not found');
    if (b.status !== BookingStatus.CONFIRMED)
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BOOKING_NOT_CANCELLABLE,
        `A ${b.status} booking cannot be cancelled`,
      );
    if (b.departureTime <= new Date())
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BOOKING_NOT_CANCELLABLE,
        'Cancellation after departure is not allowed',
      );
    return b;
  }

  /** The user sees the refund BEFORE confirming (computed by Youssef's service). */
  async refundPreview(userId: string, id: string): Promise<RefundPreview> {
    await this.ownedConfirmed(userId, id);
    return this.refundPreviews.previewRefund({
      bookingType: 'flight',
      bookingId: id,
      reason: 'user_cancellation',
    });
  }

  async cancel(userId: string, id: string) {
    await this.ownedConfirmed(userId, id);
    const cancelled = await this.cancelConfirmed(
      { _id: id, userId, departureTime: { $gt: new Date() } },
      'user',
    );
    if (!cancelled)
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_NOT_CANCELLABLE,
        'This booking can no longer be cancelled',
      );
    const refund = await this.issueRefund(
      cancelled,
      'user_cancellation',
      false,
      userId,
    );
    await this.safeNotify(() =>
      this.notifications.notify({
        userId,
        type: 'booking_cancelled',
        title: 'Flight booking cancelled',
        message: `Your booking ${cancelled.reference} was cancelled.`,
        data: { bookingType: 'flight', bookingId: id },
      }),
    );
    return { bookingId: id, status: BookingStatus.CANCELLED, refund };
  }

  /** Atomic Confirmed -> Cancelled + seats back to inventory. Returns null if it was not Confirmed. */
  private async cancelConfirmed(
    filter: QueryFilter<FlightBooking>,
    by: 'user' | 'provider' | 'system',
  ) {
    const cancelled = await this.inTransaction(async (session) => {
      const b = await this.bookings.findOneAndUpdate(
        { ...filter, status: BookingStatus.CONFIRMED },
        {
          status: BookingStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: by,
        },
        { session, returnDocument: 'after' },
      );
      if (!b) return null;
      await this.cabins.updateOne(
        { flightId: b.flightId, cabinClass: b.cabinClass },
        { $inc: { bookedSeats: -b.seatCount } },
        { session },
      );
      await this.seats.release(session, b._id); // FLT-28
      return b;
    });
    // FLT-27: an unpaid change of a cancelled booking is dropped.
    if (cancelled) await this.changes.discardOpenFor(cancelled._id);
    return cancelled;
  }

  private async issueRefund(
    b: FlightBookingDocument,
    reason: 'user_cancellation' | 'flight_cancelled',
    fullRefund: boolean,
    requestedBy?: string,
  ) {
    try {
      const r = await this.refunds.createRefund({
        bookingType: 'flight',
        bookingId: String(b._id),
        reason,
        fullRefund,
        requestedBy,
      });
      await this.bookings.updateOne(
        { _id: b._id },
        {
          refundId: r.refundId,
          refundAmount: r.amount,
          refundStatus: r.status,
        },
      );
      return r;
    } catch (e) {
      this.logger.error(
        `Refund failed for flight booking ${String(b._id)}: ${(e as Error).message}`,
      );
      await this.bookings.updateOne({ _id: b._id }, { refundStatus: 'failed' });
      return null;
    }
  }

  private async safeNotify(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      this.logger.error(`Notification failed: ${(e as Error).message}`);
    }
  }

  // ------------------------------ events from Yassin (flight.cancelled / updated)

  /** FLT-06: confirmed bookings -> Cancelled with 100% refund; holds released. Safe to run twice. */
  async handleFlightCancelled(p: FlightEventPayload): Promise<void> {
    // FLT-27: unpaid changes TO this flight are dropped (seats released).
    await this.changes.releaseForFlight(p.flightId);
    const pending = await this.bookings
      .find({ flightId: p.flightId, status: BookingStatus.PENDING_PAYMENT })
      .select('_id')
      .lean();
    for (const x of pending)
      await this.releaseInventory({
        bookingId: String(x._id),
        reason: 'cancelled',
      });

    const confirmed = await this.bookings
      .find({ flightId: p.flightId, status: BookingStatus.CONFIRMED })
      .select('_id')
      .lean();
    let failures = 0;
    for (const x of confirmed) {
      try {
        const b = await this.cancelConfirmed({ _id: x._id }, 'provider');
        if (!b) continue;
        await this.issueRefund(b, 'flight_cancelled', true);
        await this.safeNotify(() =>
          this.notifications.notify({
            userId: String(b.userId),
            type: 'booking_cancelled',
            title: 'Your flight was cancelled',
            message: `The airline cancelled flight ${b.flightNumber} (booking ${b.reference}). You will get a full refund.`,
            data: { bookingType: 'flight', bookingId: String(b._id) },
          }),
        );
      } catch (e) {
        failures++;
        this.logger.error(
          `Could not cancel booking ${String(x._id)}: ${(e as Error).message}`,
        );
      }
    }
    if (failures)
      throw new Error(
        `${failures} booking(s) failed; Yassin's outbox will retry`,
      );
  }

  /** FLT-05: refresh stored times and notify passengers with Confirmed bookings. */
  async handleFlightUpdated(p: FlightEventPayload): Promise<void> {
    const flight = await this.flights.findById(p.flightId).lean();
    if (!flight) return;
    await this.bookings.updateMany(
      {
        flightId: flight._id,
        status: {
          $in: [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED],
        },
      },
      { departureTime: flight.departureTime, arrivalTime: flight.arrivalTime },
    );
    const confirmed = await this.bookings
      .find({ flightId: flight._id, status: BookingStatus.CONFIRMED })
      .select('userId')
      .lean();
    const userIds = [...new Set(confirmed.map((b) => String(b.userId)))];
    if (userIds.length)
      await this.notifications.notifyMany(userIds, {
        type: 'flight_schedule_changed',
        title: 'Flight schedule changed',
        message: `The schedule of flight ${flight.flightNumber} has changed. Please check the new times.`,
        data: { flightId: String(flight._id) },
      });
  }

  // ------------------------------------------------------------ background jobs

  /** FLT-22: unpaid holds expire after 10 minutes and the seats are released. */
  async expireOverdueHolds(): Promise<number> {
    const overdue = await this.bookings
      .find({
        status: BookingStatus.PENDING_PAYMENT,
        holdExpiresAt: { $lte: new Date() },
      })
      .select('_id')
      .limit(500)
      .lean();
    for (const o of overdue)
      await this.releaseInventory({
        bookingId: String(o._id),
        reason: 'hold_expired',
      });
    return overdue.length;
  }

  /** GEN-11: Confirmed -> Completed once the flight has departed. */
  async completeDeparted(): Promise<void> {
    await this.bookings.updateMany(
      { status: BookingStatus.CONFIRMED, departureTime: { $lte: new Date() } },
      { status: BookingStatus.COMPLETED },
    );
  }

  // ------------------------------------------- FLT-29: airline moderator views

  async bookingsForFlight(
    user: AuthenticatedUser,
    flightId: string,
    q: FlightBookingsQueryDto,
  ) {
    const flight = await this.flights.findById(flightId).lean();
    if (!flight) throw new NotFoundException('Flight not found');
    await this.moderators.assertCanManage(
      user,
      ProviderType.AIRLINE,
      String(flight.airlineId),
    );
    const filter: QueryFilter<FlightBooking> = {
      flightId: flight._id,
      status: q.status ?? {
        $in: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
      },
    };
    const [page, cabins] = await Promise.all([
      paginate(this.bookings, filter, {
        page: q.page,
        sort: { createdAt: -1 },
        projection: {
          reference: 1,
          passengers: 1,
          cabinClass: 1,
          seatCount: 1,
          status: 1,
        },
      }),
      this.cabins.find({ flightId: flight._id }).lean(),
    ]);
    return {
      ...page,
      seatsRemaining: cabins.map((c) => ({
        cabinClass: c.cabinClass,
        remaining: c.seatCount - c.bookedSeats - c.heldSeats,
      })),
    };
  }

  async passengersCsv(
    user: AuthenticatedUser,
    flightId: string,
  ): Promise<string> {
    const flight = await this.flights.findById(flightId).lean();
    if (!flight) throw new NotFoundException('Flight not found');
    await this.moderators.assertCanManage(
      user,
      ProviderType.AIRLINE,
      String(flight.airlineId),
    );
    const rows = await this.bookings
      .find({ flightId: flight._id, status: BookingStatus.CONFIRMED })
      .sort({ createdAt: 1 })
      .lean();
    const out: CsvValue[][] = [
      [
        'Reference',
        'Passenger',
        'Passport/ID',
        'Date of birth',
        'Cabin',
        'Seat',
        'Extra bags',
        'Status',
      ],
    ];
    for (const b of rows)
      for (const p of b.passengers)
        out.push([
          b.reference,
          p.fullName,
          p.passportNumber,
          p.dateOfBirth.toISOString().slice(0, 10),
          b.cabinClass,
          p.seatNumber ?? '',
          p.extraBags,
          b.status,
        ]);
    return toCsv(out);
  }
}

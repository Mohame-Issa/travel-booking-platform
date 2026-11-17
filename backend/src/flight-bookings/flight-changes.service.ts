import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Model, Types, type ClientSession, type Connection } from 'mongoose';
import { PLATFORM_CURRENCY } from '../common/constants/currencies.js';
import {
  Airline,
  ApiException,
  BookingStatus,
  CabinInventory,
  ErrorCode,
  FARE_DIFFERENCE_REFUND_SERVICE,
  Flight,
  FlightStatus,
  NOTIFICATION_SERVICE,
  type ConfirmBookingInput,
  type FareDifferenceRefundService,
  type NotificationService,
  type ReleaseInventoryInput,
} from './flight-bookings.imports.js';
import { round2 } from './flight-bookings.utils.js';
import type { ChangeFlightDto } from './dto/flight-change.dto.js';
import { HOLD_MINUTES_FOR_CHANGES } from './flight-changes.constants.js';
import { FlightBooking } from './schemas/flight-booking.schema.js';
import {
  FlightChange,
  type FlightChangeDocument,
  FlightChangeStatus,
} from './schemas/flight-change.schema.js';
import { SeatsService } from './seats.service.js';

const DUPLICATE_KEY = 11000;

/** How a change looks to the payment module (BookingPaymentSnapshot.status). */
export const CHANGE_AS_BOOKING_STATUS: Record<
  FlightChangeStatus,
  BookingStatus
> = {
  [FlightChangeStatus.PENDING_PAYMENT]: BookingStatus.PENDING_PAYMENT,
  [FlightChangeStatus.APPLIED]: BookingStatus.CONFIRMED,
  [FlightChangeStatus.EXPIRED]: BookingStatus.EXPIRED,
  [FlightChangeStatus.CANCELLED]: BookingStatus.CANCELLED,
};

/**
 * FLT-27 (bonus): change a Confirmed flight booking's date or flight on the
 * same route and cabin. Added by Youssef Khafagy on top of Omar Hashem's
 * flight bookings.
 *
 * - Dearer flight: seats on the new flight are held for 10 minutes (like
 *   FLT-22) and the difference is paid through the normal payment flow, with
 *   the change's id as the booking id. The webhook then applies the change.
 * - Cheaper or same price: applied at once; a lower fare is refunded through
 *   Stripe (PAY-03 refunds module).
 * - Applying is one transaction: seats move between the two cabins, the seat
 *   assignments move, and the booking points at the new flight. The booking
 *   keeps its id and reference.
 */
@Injectable()
export class FlightChangesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FlightChangesService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    @InjectModel(FlightChange.name)
    private readonly changes: Model<FlightChange>,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(CabinInventory.name)
    private readonly cabins: Model<CabinInventory>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(NOTIFICATION_SERVICE)
    private readonly notifications: NotificationService,
    private readonly seats: SeatsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  // Resolved at call time, like Omar's refunds, to avoid a circular import.
  private get refunds(): FareDifferenceRefundService {
    return this.moduleRef.get<FareDifferenceRefundService>(
      FARE_DIFFERENCE_REFUND_SERVICE,
      { strict: false },
    );
  }

  onModuleInit() {
    // Unpaid changes give their held seats back after the hold (like FLT-22).
    this.timer = setInterval(() => {
      this.expireOverdue().catch((e: Error) => this.logger.error(e.message));
    }, 30_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ------------------------------------------------------------ user actions

  /** GET /flight-bookings/:id/change-quote?newFlightId=... (reserves nothing) */
  async quote(userId: string, bookingId: string, newFlightId: string) {
    const booking = await this.changeableBooking(userId, bookingId);
    const { flight, cabin } = await this.target(booking, newFlightId);
    const difference = round2(
      (cabin.price - booking.pricePerSeat) * booking.seatCount,
    );
    return {
      bookingId,
      from: flightSummary(booking),
      to: {
        flightId: String(flight._id),
        flightNumber: flight.flightNumber,
        departureTime: flight.departureTime,
        arrivalTime: flight.arrivalTime,
      },
      cabinClass: booking.cabinClass,
      seatCount: booking.seatCount,
      oldPricePerSeat: booking.pricePerSeat,
      newPricePerSeat: cabin.price,
      fareDifference: difference,
      action: difference > 0 ? 'pay' : difference < 0 ? 'refund' : 'none',
      amount: Math.abs(difference),
      newTotalAmount: round2(
        cabin.price * booking.seatCount + booking.baggageTotal,
      ),
      currency: booking.currency,
    };
  }

  /** POST /flight-bookings/:id/change */
  async request(userId: string, bookingId: string, dto: ChangeFlightDto) {
    const booking = await this.changeableBooking(userId, bookingId);
    await this.target(booking, dto.newFlightId); // clear errors before the transaction
    const passports = new Set(booking.passengers.map((p) => p.passportNumber));
    for (const s of dto.seats ?? [])
      if (!passports.has(s.passportNumber))
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.INVALID_PASSENGERS,
          `No passenger with passport/ID ${s.passportNumber} on this booking`,
        );

    let change: FlightChangeDocument;
    try {
      change = await this.inTransaction((session) =>
        this.createChange(session, userId, bookingId, dto),
      );
    } catch (e) {
      if ((e as { code?: number }).code === DUPLICATE_KEY)
        throw pendingAlready();
      throw e;
    }

    if (change.status === FlightChangeStatus.APPLIED) {
      if (change.fareDifference < 0)
        await this.refundDifference(change, userId);
      await this.notifyApplied(change);
    }
    return this.toDto(change);
  }

  /** GET /flight-bookings/:id/changes */
  async list(userId: string, bookingId: string) {
    if (!(await this.bookings.exists({ _id: bookingId, userId })))
      throw new NotFoundException('Flight booking not found');
    const rows = await this.changes
      .find({ bookingId: new Types.ObjectId(bookingId) })
      .sort({ createdAt: -1 })
      .exec();
    return rows.map((c) => this.toDto(c));
  }

  // --------------------- called through FLIGHT_BOOKING_LIFECYCLE / _READER

  isChange(id: string) {
    return this.changes.exists({ _id: id });
  }

  findById(id: string) {
    return this.changes.findById(id).lean().exec();
  }

  /**
   * The fare difference was paid (webhook, PAY-01): apply the change.
   * Idempotent. Answers 409 if it can no longer be applied (hold expired, or
   * the booking was cancelled meanwhile); the webhook then refunds the money.
   */
  async confirmChange({ bookingId: changeId, paymentId }: ConfirmBookingInput) {
    const existing = await this.changes.findById(changeId).lean();
    if (!existing) throw new NotFoundException('Flight change not found');
    if (
      existing.status === FlightChangeStatus.APPLIED &&
      existing.paymentId === paymentId
    )
      return; // webhook retry

    let applied: FlightChangeDocument | null = null;
    try {
      applied = await this.inTransaction(async (session) => {
        const c = await this.changes.findOneAndUpdate(
          {
            _id: changeId,
            status: FlightChangeStatus.PENDING_PAYMENT,
            holdExpiresAt: { $gt: new Date() },
          },
          { $set: { paymentId } },
          { session, returnDocument: 'after' },
        );
        if (!c) return null;
        await this.apply(session, c);
        return c;
      });
    } catch (e) {
      if (
        e instanceof ApiException &&
        e.code === ErrorCode.BOOKING_NOT_CHANGEABLE
      ) {
        // The booking was cancelled or departed while the user was paying.
        await this.release(changeId, FlightChangeStatus.CANCELLED);
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.BOOKING_NOT_CHANGEABLE,
          'The booking can no longer be changed',
        );
      }
      throw e;
    }
    if (!applied)
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.HOLD_EXPIRED,
        'Change cannot be applied (hold expired or wrong status)',
      );
    await this.notifyApplied(applied);
  }

  /** Hold expired (payment expiry job) or cancelled: give the held seats back. */
  async releaseInventory({
    bookingId: changeId,
    reason,
  }: ReleaseInventoryInput) {
    await this.release(
      changeId,
      reason === 'cancelled'
        ? FlightChangeStatus.CANCELLED
        : FlightChangeStatus.EXPIRED,
    );
  }

  // ------------------------------------------------ hooks from Omar's service

  /** The booking was cancelled: an unpaid change of it is dropped. */
  async discardOpenFor(bookingId: Types.ObjectId | string) {
    const open = await this.changes
      .find({
        bookingId: new Types.ObjectId(String(bookingId)),
        status: FlightChangeStatus.PENDING_PAYMENT,
      })
      .select('_id')
      .lean();
    for (const c of open)
      await this.release(String(c._id), FlightChangeStatus.CANCELLED);
  }

  /** FLT-06: the NEW flight was cancelled: unpaid changes to it are dropped. */
  async releaseForFlight(flightId: string) {
    const open = await this.changes
      .find({
        toFlightId: new Types.ObjectId(flightId),
        status: FlightChangeStatus.PENDING_PAYMENT,
      })
      .select('_id')
      .lean();
    for (const c of open)
      await this.release(String(c._id), FlightChangeStatus.CANCELLED);
  }

  /** Unpaid changes past their hold. */
  async expireOverdue(): Promise<number> {
    const overdue = await this.changes
      .find({
        status: FlightChangeStatus.PENDING_PAYMENT,
        holdExpiresAt: { $lte: new Date() },
      })
      .select('_id')
      .limit(500)
      .lean();
    for (const c of overdue)
      await this.release(String(c._id), FlightChangeStatus.EXPIRED);
    return overdue.length;
  }

  // ---------------------------------------------------------------- internals

  private async createChange(
    session: ClientSession,
    userId: string,
    bookingId: string,
    dto: ChangeFlightDto,
  ): Promise<FlightChangeDocument> {
    const now = new Date();
    // (1) Touch the booking: serializes with a parallel cancel or change.
    const booking = await this.bookings.findOneAndUpdate(
      {
        _id: bookingId,
        userId,
        status: BookingStatus.CONFIRMED,
        departureTime: { $gt: now },
      },
      { $set: { updatedAt: now } },
      { session, returnDocument: 'after' },
    );
    if (!booking) throw notChangeable();
    if (
      await this.changes
        .exists({
          bookingId: booking._id,
          status: FlightChangeStatus.PENDING_PAYMENT,
        })
        .session(session)
    )
      throw pendingAlready();

    // (2) New flight still bookable (same touch as Omar's FLT-22 hold).
    const flight = await this.flights.findOneAndUpdate(
      {
        _id: dto.newFlightId,
        status: FlightStatus.SCHEDULED,
        departureTime: { $gt: now },
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

    // (3) "Subject to seat availability": one atomic capacity check + hold.
    const cabin = await this.cabins.findOneAndUpdate(
      {
        flightId: flight._id,
        cabinClass: booking.cabinClass,
        $expr: {
          $lte: [
            { $add: ['$bookedSeats', '$heldSeats', booking.seatCount] },
            '$seatCount',
          ],
        },
      },
      { $inc: { heldSeats: booking.seatCount } },
      { session, returnDocument: 'after' },
    );
    if (!cabin)
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.SEATS_UNAVAILABLE,
        'Not enough seats left in this cabin on the new flight',
      );

    // (4) The change, priced from the cabin as it is now.
    const difference = round2(
      (cabin.price - booking.pricePerSeat) * booking.seatCount,
    );
    const changeId = new Types.ObjectId();
    const [change] = await this.changes.create(
      [
        {
          _id: changeId,
          bookingId: booking._id,
          userId: booking.userId,
          airlineId: booking.airlineId,
          fromFlightId: booking.flightId,
          toFlightId: flight._id,
          cabinClass: booking.cabinClass,
          seatCount: booking.seatCount,
          toFlightNumber: flight.flightNumber,
          toDepartureTime: flight.departureTime,
          toArrivalTime: flight.arrivalTime,
          oldPricePerSeat: booking.pricePerSeat,
          newPricePerSeat: cabin.price,
          fareDifference: difference,
          amountDue: Math.max(0, difference),
          currency: PLATFORM_CURRENCY, // PAY-04
          status: FlightChangeStatus.PENDING_PAYMENT,
          holdExpiresAt: new Date(
            now.getTime() + HOLD_MINUTES_FOR_CHANGES * 60_000,
          ),
        },
      ],
      { session },
    );

    // (5) FLT-28: a seat on the new flight for every passenger.
    const chosen = new Map(
      (dto.seats ?? []).map((s) => [s.passportNumber, s.seatNumber]),
    );
    await this.seats.assign(session, {
      flightId: flight._id,
      cabinClass: booking.cabinClass,
      ownerId: changeId,
      requests: booking.passengers.map((p) => ({
        passportNumber: p.passportNumber,
        seatNumber: chosen.get(p.passportNumber),
      })),
    });

    // (6) Nothing to pay: apply right away (a lower fare is refunded after commit).
    if (difference <= 0) await this.apply(session, change);
    return change;
  }

  /** Moves the booking onto the new flight. Runs inside the caller's transaction. */
  private async apply(session: ClientSession, change: FlightChangeDocument) {
    const booking = await this.bookings
      .findOne({
        _id: change.bookingId,
        flightId: change.fromFlightId,
        status: BookingStatus.CONFIRMED,
        departureTime: { $gt: new Date() },
      })
      .session(session);
    if (!booking) throw notChangeable();

    const n = change.seatCount;
    await this.cabins.updateOne(
      { flightId: change.toFlightId, cabinClass: change.cabinClass },
      { $inc: { heldSeats: -n, bookedSeats: n } },
      { session },
    );
    await this.cabins.updateOne(
      { flightId: change.fromFlightId, cabinClass: change.cabinClass },
      { $inc: { bookedSeats: -n } },
      { session },
    );
    await this.seats.release(session, booking._id); // old flight's seats
    await this.seats.transfer(session, change._id, booking._id);
    const seatOf = await this.seats.seatsOf(session, booking._id);

    booking.flightId = change.toFlightId;
    booking.flightNumber = change.toFlightNumber;
    booking.departureTime = change.toDepartureTime;
    booking.arrivalTime = change.toArrivalTime;
    booking.pricePerSeat = change.newPricePerSeat;
    booking.totalAmount = round2(
      change.newPricePerSeat * n + booking.baggageTotal,
    );
    booking.passengers.forEach((p) => {
      p.seatNumber = seatOf.get(p.passportNumber) ?? p.seatNumber;
    });
    await booking.save({ session });

    change.status = FlightChangeStatus.APPLIED;
    change.holdExpiresAt = null;
    change.appliedAt = new Date();
    await change.save({ session });
  }

  /** Pending -> Expired/Cancelled, held seats back. Idempotent. */
  private async release(changeId: string, status: FlightChangeStatus) {
    await this.inTransaction(async (session) => {
      const c = await this.changes.findOneAndUpdate(
        { _id: changeId, status: FlightChangeStatus.PENDING_PAYMENT },
        { $set: { status, holdExpiresAt: null } },
        { session, returnDocument: 'after' },
      );
      if (!c) return; // already applied or released
      await this.cabins.updateOne(
        { flightId: c.toFlightId, cabinClass: c.cabinClass },
        { $inc: { heldSeats: -c.seatCount } },
        { session },
      );
      await this.seats.release(session, c._id);
    });
  }

  private async refundDifference(change: FlightChangeDocument, userId: string) {
    try {
      const r = await this.refunds.refundFareDifference({
        bookingType: 'flight',
        bookingId: String(change.bookingId),
        changeId: String(change._id),
        amount: -change.fareDifference,
        requestedBy: userId,
      });
      change.refundId = r.refundId;
      change.refundAmount = r.amount;
      change.refundStatus = r.status;
    } catch (e) {
      // The change stands; the refund is recorded as failed (like Omar's cancel).
      if (!(e instanceof HttpException))
        this.logger.error((e as Error).message);
      change.refundStatus = 'failed';
    }
    await change.save();
  }

  /** The booking must be mine, Confirmed and not departed. */
  private async changeableBooking(userId: string, bookingId: string) {
    const b = await this.bookings.findOne({ _id: bookingId, userId }).lean();
    if (!b) throw new NotFoundException('Flight booking not found');
    if (b.status !== BookingStatus.CONFIRMED || b.departureTime <= new Date())
      throw notChangeable();
    return b;
  }

  /** FLT-27: same route, same cabin, same airline, bookable, enough seats. */
  private async target(booking: FlightBooking, newFlightId: string) {
    if (String(booking.flightId) === newFlightId)
      throw invalidChange('The booking is already on this flight');
    const flight = await this.flights.findById(newFlightId).lean();
    if (!flight) throw new NotFoundException('Flight not found');
    if (
      flight.departureAirport !== booking.departureAirport ||
      flight.arrivalAirport !== booking.arrivalAirport
    )
      throw invalidChange(
        `The new flight must fly the same route (${booking.departureAirport} to ${booking.arrivalAirport})`,
      );
    // Assumption: same airline, so the accepted policies and baggage fees still apply.
    if (String(flight.airlineId) !== String(booking.airlineId))
      throw invalidChange(
        'The new flight must be operated by the same airline',
      );
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
    if (!airline || airline.status !== 'active')
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.AIRLINE_INACTIVE,
        'This airline is not accepting bookings',
      );
    const cabin = await this.cabins
      .findOne({ flightId: flight._id, cabinClass: booking.cabinClass })
      .lean();
    if (!cabin)
      throw new NotFoundException(
        `The new flight has no ${booking.cabinClass} cabin`,
      );
    if (
      cabin.seatCount - cabin.bookedSeats - cabin.heldSeats <
      booking.seatCount
    )
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.SEATS_UNAVAILABLE,
        'Not enough seats left in this cabin on the new flight',
      );
    return { flight, cabin };
  }

  private async notifyApplied(change: FlightChange) {
    try {
      await this.notifications.notify({
        userId: String(change.userId),
        type: 'booking_confirmed',
        title: 'Flight booking changed',
        message: `Your booking now uses flight ${change.toFlightNumber}. Download your updated e-ticket.`,
        data: { bookingType: 'flight', bookingId: String(change.bookingId) },
      });
    } catch (e) {
      this.logger.error(`Notification failed: ${(e as Error).message}`);
    }
  }

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

  private toDto(c: FlightChange & { _id: Types.ObjectId }) {
    const pending = c.status === FlightChangeStatus.PENDING_PAYMENT;
    return {
      changeId: String(c._id),
      bookingId: String(c.bookingId),
      status: c.status,
      toFlightId: String(c.toFlightId),
      toFlightNumber: c.toFlightNumber,
      toDepartureTime: c.toDepartureTime,
      oldPricePerSeat: c.oldPricePerSeat,
      newPricePerSeat: c.newPricePerSeat,
      fareDifference: c.fareDifference,
      amountDue: c.amountDue,
      currency: c.currency,
      holdExpiresAt: c.holdExpiresAt,
      refund:
        c.refundStatus !== undefined
          ? {
              refundId: c.refundId ?? null,
              amount: c.refundAmount ?? 0,
              status: c.refundStatus,
            }
          : null,
      // How to pay the difference: the change id is the "booking id" (PAY-01, PAY-02).
      nextSteps: pending
        ? [
            `POST /api/bookings/flight/${String(c._id)}/accept-policies`,
            `POST /api/payments {"bookingType":"flight","bookingId":"${String(c._id)}"}`,
          ]
        : [],
      createdAt: c.createdAt,
      appliedAt: c.appliedAt ?? null,
    };
  }
}

function flightSummary(b: FlightBooking) {
  return {
    flightId: String(b.flightId),
    flightNumber: b.flightNumber,
    departureTime: b.departureTime,
    arrivalTime: b.arrivalTime,
  };
}

function notChangeable() {
  return new ApiException(
    HttpStatus.CONFLICT,
    ErrorCode.BOOKING_NOT_CHANGEABLE,
    'Only a Confirmed booking can be changed, before departure',
  );
}

function invalidChange(message: string) {
  return new ApiException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.INVALID_FLIGHT_CHANGE,
    message,
  );
}

function pendingAlready() {
  return new ApiException(
    HttpStatus.CONFLICT,
    ErrorCode.CHANGE_ALREADY_PENDING,
    'This booking already has an unpaid change. Pay it or wait for it to expire.',
  );
}

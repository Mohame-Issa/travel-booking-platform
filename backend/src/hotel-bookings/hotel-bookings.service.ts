
import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, type Connection } from 'mongoose';
import { ErrorCode } from '../common/constants/error-codes.js';
import { UserRole } from '../common/constants/roles.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import {
  BookingStatus,
  NOTIFICATION_SERVICE,
  type BookingLifecycleService,
  type BookingPaymentReader,
  type BookingPaymentSnapshot,
  type ConfirmBookingInput,
  type NotificationService,
  type NotifyInput,
  type ReleaseInventoryInput,
  type UpcomingConfirmedBookingsChecker,
} from '../common/interfaces/index.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { paginate } from '../common/utils/paginate.js';
import { ProviderStatus } from '../flights/catalogue.constants.js';
import { lockRooms } from '../hotels/room-lock.js';
import { roomIsFree } from '../hotels/room-search.js';
import { HotelPolicy } from '../hotels/schemas/hotel-policy.schema.js';
import { Hotel } from '../hotels/schemas/hotel.schema.js';
import {
  RoomAvailability,
  RoomAvailabilityKind,
} from '../hotels/schemas/room-availability.schema.js';
import { Room } from '../hotels/schemas/room.schema.js';
import {
  groupFilter,
  HOLD_MS,
  newReference,
  parseStay,
  stayTotal,
  validateGuests,
} from './booking-rules.js';
import type {
  CreateHotelBookingDto,
  HotelBookingQueryDto,
} from './dto/hotel-booking.dto.js';
import { HotelBooking } from './schemas/hotel-booking.schema.js';

/** Technical polling interval, not a business rule (the hold itself is HTL-18's 10 minutes). */
const SWEEP_EVERY_MS = 60_000;
/** Technical: Stripe webhook latency tolerated after the hold ends; beyond it payments refund. */
export const CONFIRM_GRACE_MS = 2 * 60_000;

const conflict = (code: ErrorCode, message: string) =>
  new ApiException(HttpStatus.CONFLICT, code, message);

/**
 * Hotel reservations (HTL-16..HTL-20, GEN-11) on Yassin's shared RoomAvailability rows:
 * a reservation adds one row per room ([checkIn, checkOut), bookingId) of kind
 * "Pending Payment" with holdExpiresAt, flipped to "Confirmed" on payment and deleted
 * on expiry/cancellation, so the room's Available ranges are never rewritten.
 *
 * Bound to HOTEL_BOOKING_LIFECYCLE / HOTEL_BOOKING_PAYMENT_READER (Youssef) and
 * HOTEL_UPCOMING_BOOKINGS_CHECKER (Amr).
 */
@Injectable()
export class HotelBookingsService
  implements
    BookingLifecycleService,
    BookingPaymentReader,
    UpcomingConfirmedBookingsChecker,
    OnModuleInit,
    OnModuleDestroy
{
  private readonly logger = new Logger(HotelBookingsService.name);
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomAvailability.name)
    private readonly availability: Model<RoomAvailability>,
    @InjectModel(HotelPolicy.name)
    private readonly policies: Model<HotelPolicy>,
    @Inject(NOTIFICATION_SERVICE)
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** HTL-16/HTL-18: hold every selected room together for 10 minutes, or none of them. */
  async create(dto: CreateHotelBookingDto, userId: string) {
    const { start, end, nights } = parseStay(dto.checkInDate, dto.checkOutDate);
    const hotel = await this.hotels.findById(dto.hotelId).lean().exec();

    if (!hotel) throw new NotFoundException('Hotel not found');

    if (hotel.status !== ProviderStatus.ACTIVE) {
      throw conflict(
        ErrorCode.PROVIDER_DEACTIVATED,
        'This hotel is not accepting reservations',
      );
    }

    const ids = dto.rooms.map((r) => r.roomId);

    const found = await this.rooms
      .find({ _id: { $in: ids }, hotelId: hotel._id })
      .lean()
      .exec();

    const byId = new Map(found.map((room) => [String(room._id), room]));

    validateGuests(dto.rooms, byId);

    const missing = ids.find((id) => !byId.has(id));

    if (missing) {
      throw new NotFoundException(`Room ${missing} not found in this hotel`);
    }

    const policy = await this.policies
      .findOne({ hotelId: hotel._id })
      .lean()
      .exec();

    return this.connection.transaction(async (session) => {
      await lockRooms(this.rooms, ids, session);

      const currentHotel = await this.hotels
        .findById(hotel._id)
        .session(session)
        .lean()
        .exec();

      if (
        !currentHotel ||
        currentHotel.status !== ProviderStatus.ACTIVE
      ) {
        throw conflict(
          ErrorCode.PROVIDER_DEACTIVATED,
          'This hotel is not accepting reservations',
        );
      }

      const now = new Date();

      // Re-read room status and prices inside the transaction.
      const active = await this.rooms
        .find({ _id: { $in: ids }, status: ProviderStatus.ACTIVE })
        .session(session)
        .lean()
        .exec();

      for (const room of active) {
        byId.set(String(room._id), room);
      }

      validateGuests(dto.rooms, byId);

      const rows = await this.availability
        .find({
          roomId: { $in: ids },
          startDate: { $lt: end },
          endDate: { $gt: start },
        })
        .session(session)
        .lean()
        .exec();

      for (const room of found) {
        const free =
          active.some((a) => String(a._id) === String(room._id)) &&
          roomIsFree(
            rows.filter((r) => String(r.roomId) === String(room._id)),
            start,
            end,
            now,
          );

        if (!free) {
          throw conflict(
            ErrorCode.ROOM_NOT_AVAILABLE,
            `Room ${room.roomNumber} is not available for the selected dates; nothing was held (HTL-18)`,
          );
        }
      }

      const holdExpiresAt = new Date(+now + HOLD_MS);

      const [booking] = await this.bookings.create(
        [
          {
            userId,
            hotelId: hotel._id,
            rooms: dto.rooms.map((r) => {
              const room = byId.get(r.roomId)!;

              return {
                roomId: room._id,
                roomNumber: room.roomNumber,
                type: room.type,
                pricePerNight: room.pricePerNight,
                adults: r.adults,
                childrenAges: r.childrenAges ?? [],
              };
            }),
            checkInDate: start,
            checkOutDate: end,
            nights,
            totalAmount: stayTotal(
              dto.rooms.map((r) => byId.get(r.roomId)!.pricePerNight),
              nights,
            ),
            currency: hotel.currency,
            status: BookingStatus.PENDING_PAYMENT,
            holdExpiresAt,
            policy: {
              checkInTime: policy?.checkInTime ?? null,
              checkOutTime: policy?.checkOutTime ?? null,
              cancellationTiers: policy?.cancellationTiers ?? [],
            },
          },
        ],
        { session },
      );

      await this.availability.insertMany(
        found.map((room) => ({
          roomId: room._id,
          startDate: start,
          endDate: end,
          kind: RoomAvailabilityKind.HELD,
          bookingId: booking._id,
          holdExpiresAt,
        })),
        { session },
      );

      return booking.toObject();
    });
  }

  /** HTL-20: own reservations, optionally one group, newest stay first. */
  listMine(userId: string, query: HotelBookingQueryDto) {
    return paginate(
      this.bookings,
      { userId, ...groupFilter(query.group, new Date()) },
      {
        page: query.page,
        sort: { checkInDate: -1 },
        populate: { path: 'hotelId', select: 'name address cityId' },
      },
    );
  }

  /** HTL-20 details. Someone else's reservation answers 404 (admins may read any). */
  async getOne(id: string, user: AuthenticatedUser) {
    const booking = await this.bookings
      .findById(id)
      .populate({ path: 'hotelId', select: 'name address cityId countryCode' })
      .lean()
      .exec();

    if (
      !booking ||
      (String(booking.userId) !== user.id && user.role !== UserRole.ADMIN)
    ) {
      throw new NotFoundException('Reservation not found');
    }

    return booking;
  }

  /** PAY-01 / HTL-17. Idempotent; 409 when the reservation can no longer be confirmed. */
  async confirmBooking({
    bookingId,
    paymentId,
  }: ConfirmBookingInput): Promise<void> {
    if (!isValidObjectId(bookingId)) {
      throw new NotFoundException('Reservation not found');
    }

    const confirmed = await this.connection.transaction(async (session) => {
      const booking = await this.bookings
        .findById(bookingId)
        .session(session)
        .exec();

      if (!booking) {
        throw new NotFoundException('Reservation not found');
      }

      if (
        [BookingStatus.CONFIRMED, BookingStatus.COMPLETED].includes(
          booking.status,
        )
      ) {
        return null;
      }

      if (booking.status !== BookingStatus.PENDING_PAYMENT) {
        throw conflict(
          ErrorCode.BOOKING_NOT_CONFIRMABLE,
          `The reservation is ${booking.status} (GEN-11)`,
        );
      }

      const hotel = await this.hotels
        .findById(booking.hotelId)
        .session(session)
        .lean()
        .exec();

      if (!hotel || hotel.status !== ProviderStatus.ACTIVE) {
        throw conflict(
          ErrorCode.BOOKING_NOT_CONFIRMABLE,
          'The hotel is no longer accepting reservations. The payment cannot be confirmed.',
        );
      }

      const now = new Date();

      // HTL-18: a payment later than the hold (plus webhook latency) is refunded, never confirmed.
      if (
        booking.holdExpiresAt &&
        +now > +booking.holdExpiresAt + CONFIRM_GRACE_MS
      ) {
        throw conflict(
          ErrorCode.BOOKING_NOT_CONFIRMABLE,
          'The 10-minute hold expired before payment (HTL-18)',
        );
      }

      const roomIds = booking.rooms.map((r) => r.roomId);

      await lockRooms(this.rooms, roomIds, session);

      const activeRooms = await this.rooms
        .countDocuments({
          _id: { $in: roomIds },
          status: ProviderStatus.ACTIVE,
        })
        .session(session);

      const rows = await this.availability
        .find({
          roomId: { $in: roomIds },
          startDate: { $lt: booking.checkOutDate },
          endDate: { $gt: booking.checkInDate },
        })
        .session(session)
        .lean()
        .exec();

      const mine = (r: { bookingId: unknown }) =>
        String(r.bookingId) === bookingId;

      const own = rows.filter(
        (r) => mine(r) && r.kind === RoomAvailabilityKind.HELD,
      );

      // Late payment after an expired hold: only confirm if nobody else took or blocked the rooms.
      const stillFree = roomIds.every((roomId) =>
        roomIsFree(
          rows.filter((r) => String(r.roomId) === String(roomId) && !mine(r)),
          booking.checkInDate,
          booking.checkOutDate,
          now,
        ),
      );

      if (
        own.length !== roomIds.length ||
        !stillFree ||
        activeRooms !== roomIds.length
      ) {
        throw conflict(
          ErrorCode.BOOKING_NOT_CONFIRMABLE,
          'The held rooms are no longer available',
        );
      }

      await this.availability
        .updateMany(
          { _id: { $in: own.map((r) => r._id) } },
          { $set: { kind: RoomAvailabilityKind.BOOKED, holdExpiresAt: null } },
          { session },
        )
        .exec();

      booking.set({
        status: BookingStatus.CONFIRMED,
        reference: newReference(),
        paymentId,
        confirmedAt: now,
        holdExpiresAt: null,
      });

      await booking.save({ session });

      return booking;
    });

    if (confirmed) {
      await this.notifySafely({
        userId: String(confirmed.userId),
        type: 'booking_confirmed',
        title: 'Hotel reservation confirmed',
        message: `Your reservation ${confirmed.reference} is confirmed: ${confirmed.rooms.length} room(s), ${confirmed.nights} night(s) from ${confirmed.checkInDate.toISOString().slice(0, 10)}, ${confirmed.totalAmount} ${confirmed.currency}.`,
        data: {
          bookingType: 'hotel',
          bookingId,
          reference: confirmed.reference,
        },
      });
    }
  }

  /**
   * Gives the rooms back. Payment failure / expiry / hold timeout: Pending Payment -> Expired.
   * 'cancelled' (Omar's cancel flow): Confirmed -> Cancelled. Idempotent.
   */
  async releaseInventory({
    bookingId,
    reason,
  }: ReleaseInventoryInput): Promise<void> {
    if (!isValidObjectId(bookingId)) return;

    const expiring = reason !== 'cancelled';

    const released = await this.connection.transaction(async (session) => {
      const booking = await this.bookings
        .findById(bookingId)
        .session(session)
        .exec();

      if (!booking) return null;

      const from = expiring
        ? BookingStatus.PENDING_PAYMENT
        : BookingStatus.CONFIRMED;

      const to = expiring ? BookingStatus.EXPIRED : BookingStatus.CANCELLED;

      if (booking.status === to) return null;

      if (booking.status !== from) {
        if (
          expiring &&
          [BookingStatus.CONFIRMED, BookingStatus.COMPLETED].includes(
            booking.status,
          )
        ) {
          return null;
        }

        throw conflict(
          ErrorCode.CONFLICT,
          `A ${booking.status} reservation cannot be ${to.toLowerCase()} (GEN-11)`,
        );
      }

      await lockRooms(
        this.rooms,
        booking.rooms.map((r) => r.roomId),
        session,
      );

      await this.availability
        .deleteMany(
          {
            bookingId: booking._id,
            kind: expiring
              ? RoomAvailabilityKind.HELD
              : RoomAvailabilityKind.BOOKED,
          },
          { session },
        )
        .exec();

      booking.set({
        status: to,
        ...(expiring ? {} : { cancelledAt: new Date() }),
      });

      await booking.save({ session });

      return booking;
    });

    if (released && expiring) {
      await this.notifySafely({
        userId: String(released.userId),
        type: 'payment_failed',
        title: 'Hotel reservation expired',
        message: `Payment for your reservation from ${released.checkInDate.toISOString().slice(0, 10)} did not complete in time, so the rooms were released.`,
        data: { bookingType: 'hotel', bookingId, reason },
      });
    }
  }

  /** PAY-01/02/03 read model. */
  async getPaymentSnapshot(
    bookingId: string,
  ): Promise<BookingPaymentSnapshot | null> {
    if (!isValidObjectId(bookingId)) return null;

    const b = await this.bookings.findById(bookingId).lean().exec();

    if (!b) return null;

    return {
      bookingId: String(b._id),
      userId: String(b.userId),
      status: b.status,
      totalAmount: b.totalAmount,
      currency: b.currency,
      holdExpiresAt:
        b.status === BookingStatus.PENDING_PAYMENT ? b.holdExpiresAt : null,
      startsAt: b.checkInDate,
      policies: {
        cancellationTiers: b.policy.cancellationTiers.map(
          ({ daysBefore, refundPercentage }) => ({
            daysBefore,
            refundPercentage,
          }),
        ),
        baggagePolicy: null,
        checkInTime: b.policy.checkInTime,
        checkOutTime: b.policy.checkOutTime,
      },
    };
  }

  /** ACC-12: a Confirmed reservation whose check-out is still ahead. */
  async hasUpcomingConfirmedBookings(userId: string): Promise<boolean> {
    if (!isValidObjectId(userId)) return false;

    return !!(await this.bookings.exists({
      userId,
      status: BookingStatus.CONFIRMED,
      checkOutDate: { $gt: new Date() },
    }));
  }

  /**
   * HTL-18: expire holds nobody paid for.
   * HTL-23 / GEN-11: Confirmed -> Completed once the check-out date has passed.
   */
  async sweep(now = new Date()): Promise<void> {
    if (this.sweeping) return;

    this.sweeping = true;

    try {
      const due = await this.bookings
        .find(
          {
            status: BookingStatus.PENDING_PAYMENT,
            holdExpiresAt: { $lte: new Date(+now - CONFIRM_GRACE_MS) },
          },
          { _id: 1 },
        )
        .lean()
        .exec();

      for (const { _id } of due) {
        try {
          await this.releaseInventory({
            bookingId: String(_id),
            reason: 'hold_expired',
          });
        } catch (err) {
          this.logger.warn(
            `Could not expire reservation ${String(_id)}: ${(err as Error).message}`,
          );
        }
      }

      await this.bookings
        .updateMany(
          {
            status: BookingStatus.CONFIRMED,
            checkOutDate: { $lte: now },
          },
          { $set: { status: BookingStatus.COMPLETED } },
        )
        .exec();
    } catch (err) {
      this.logger.warn(`Reservation sweep failed: ${(err as Error).message}`);
    } finally {
      this.sweeping = false;
    }
  }

  /** The state change is committed; a notification outage must not undo or retry it. */
  private async notifySafely(input: NotifyInput) {
    try {
      await this.notifications.notify(input);
    } catch (err) {
      this.logger.error(
        `Notification ${input.type} for ${String(input.data?.bookingId)} not saved: ${(err as Error).message}`,
      );
    }
  }
}

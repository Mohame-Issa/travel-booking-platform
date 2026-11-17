import {
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import {
  type BookingPaymentReader,
  type BookingPaymentSnapshot,
  BookingStatus,
  type BookingType,
  FLIGHT_BOOKING_PAYMENT_READER,
  HOTEL_BOOKING_PAYMENT_READER,
} from '../common/interfaces/index.js';
import type {
  LinkBookingDto,
  LinkedBookingDto,
} from './dto/itinerary-booking.dto.js';
import { ItineraryDaysService } from './itinerary-days.service.js';
import { ItineraryBooking } from './schemas/itinerary-booking.schema.js';

const DUPLICATE_KEY = 11000;
/** Bookings that are (or were) really happening; cancelled / expired ones are not. */
const COUNTED = new Set<string>([
  BookingStatus.CONFIRMED,
  BookingStatus.COMPLETED,
]);

/**
 * ITN-27 (bonus): link booked flights and hotels to itinerary days, feeding
 * the budget. Bookings are read through the shared BookingPaymentReader
 * contract (Omar Hashem's and Mohamed Hashad's readers, the same ones
 * payments use), so this module never touches their schemas.
 */
@Injectable()
export class ItineraryBookingsService {
  constructor(
    @InjectModel(ItineraryBooking.name)
    private readonly links: Model<ItineraryBooking>,
    @Inject(FLIGHT_BOOKING_PAYMENT_READER)
    private readonly flights: BookingPaymentReader,
    @Inject(HOTEL_BOOKING_PAYMENT_READER)
    private readonly hotels: BookingPaymentReader,
    private readonly days: ItineraryDaysService,
  ) {}

  /** POST /api/itineraries/:id/bookings */
  async link(
    itineraryId: string,
    userId: string,
    dto: LinkBookingDto,
  ): Promise<LinkedBookingDto> {
    const day = await this.days.findInItinerary(itineraryId, dto.dayId);
    const booking = await this.reader(dto.bookingType).getPaymentSnapshot(
      dto.bookingId,
    );
    // Someone else's booking answers 404 too: never reveal that it exists.
    if (!booking || booking.userId !== userId)
      throw new NotFoundException('Booking not found');
    if (!COUNTED.has(booking.status)) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_NOT_LINKABLE,
        `Only Confirmed or Completed bookings can be linked (this one is ${booking.status})`,
      );
    }
    try {
      const link = await this.links.create({
        itineraryId: day.itineraryId,
        dayId: day._id,
        userId: day.userId,
        bookingType: dto.bookingType,
        bookingId: new Types.ObjectId(dto.bookingId),
      });
      await this.days.touch(day.itineraryId);
      return toDto(link, booking);
    } catch (err) {
      if ((err as { code?: number }).code === DUPLICATE_KEY) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.BOOKING_ALREADY_LINKED,
          'This booking is already linked to this itinerary',
        );
      }
      throw err;
    }
  }

  /** DELETE /api/itineraries/:id/bookings/:linkId */
  async unlink(itineraryId: string, linkId: string): Promise<void> {
    const res = await this.links
      .deleteOne({ _id: linkId, itineraryId: new Types.ObjectId(itineraryId) })
      .exec();
    if (res.deletedCount === 0)
      throw new NotFoundException('Linked booking not found in this itinerary');
    await this.days.touch(itineraryId);
  }

  /** All links of an itinerary with the bookings' current amount and status. */
  async forItinerary(
    itineraryId: string | Types.ObjectId,
  ): Promise<LinkedBookingDto[]> {
    const rows = await this.links
      .find({ itineraryId: new Types.ObjectId(String(itineraryId)) })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    const out: LinkedBookingDto[] = [];
    for (const link of rows) {
      const booking = await this.reader(link.bookingType).getPaymentSnapshot(
        link.bookingId.toString(),
      );
      // A booking that no longer exists is simply left out.
      if (booking) out.push(toDto(link, booking));
    }
    return out;
  }

  private reader(type: BookingType): BookingPaymentReader {
    return type === 'flight' ? this.flights : this.hotels;
  }
}

function toDto(
  link: {
    _id: Types.ObjectId;
    dayId: Types.ObjectId;
    bookingType: BookingType;
    bookingId: Types.ObjectId;
  },
  booking: BookingPaymentSnapshot,
): LinkedBookingDto {
  return {
    id: link._id.toString(),
    dayId: link.dayId.toString(),
    bookingType: link.bookingType,
    bookingId: link.bookingId.toString(),
    status: booking.status,
    amount: booking.totalAmount,
    currency: booking.currency,
    countsInBudget: COUNTED.has(booking.status),
  };
}

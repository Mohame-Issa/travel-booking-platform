import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ErrorCode } from '../common/constants/error-codes.js';
import { UserStatus } from '../common/constants/roles.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { BookingStatus } from '../common/interfaces/index.js';
import { paginate } from '../common/utils/paginate.js';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema.js';
import { Hotel } from '../hotels/schemas/hotel.schema.js';
import { User } from '../users/schemas/user.schema.js';
import type {
  CreateReviewDto,
  HotelReviewsDto,
  ReviewDto,
  UpdateReviewDto,
} from './dto/review.dto.js';
import { Review } from './schemas/review.schema.js';

/** Mongo duplicate-key error code. */
const DUPLICATE_KEY = 11000;
/** ACC-12 */
const DELETED_USER = 'Deleted user';

type ReviewRow = Review & { _id: Types.ObjectId };

/**
 * Hotel reviews (HTL-23, HTL-24). Taken over from Omar Rashed's part.
 * After every create / edit / delete / hide, the hotel's averageRating and
 * ratingCount (Yassin Shawr's Hotel fields) are recalculated from the
 * visible reviews, so they can never drift.
 */
@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private readonly reviews: Model<Review>,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  /** POST /api/hotel-bookings/:id/review (owner checked by @CheckOwnership). */
  async create(bookingId: string, dto: CreateReviewDto): Promise<ReviewDto> {
    const booking = await this.bookings.findById(bookingId).lean().exec();
    if (!booking) throw new NotFoundException('Reservation not found');

    // HTL-23: only a Completed stay. A Confirmed stay whose check-out date has
    // passed is completed by definition, even if the background job that
    // flips the status has not run yet.
    const completed =
      booking.status === BookingStatus.COMPLETED ||
      (booking.status === BookingStatus.CONFIRMED &&
        booking.checkOutDate <= new Date());
    if (!completed) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.STAY_NOT_COMPLETED,
        'You can review a stay only after its check-out date (HTL-23)',
      );
    }

    try {
      const review = await this.reviews.create({
        userId: booking.userId,
        hotelId: booking.hotelId,
        bookingId: booking._id,
        rating: dto.rating,
        comment: dto.comment ?? '',
      });
      await this.recalculate(booking.hotelId);
      return this.toDto(review.toObject() as ReviewRow);
    } catch (err) {
      // HTL-23: one review per reservation, regardless of the number of rooms.
      if ((err as { code?: number }).code === DUPLICATE_KEY) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.REVIEW_ALREADY_EXISTS,
          'This reservation already has a review; edit it instead',
        );
      }
      throw err;
    }
  }

  /** PATCH /api/reviews/:id (owner checked by @CheckOwnership). */
  async update(id: string, dto: UpdateReviewDto): Promise<ReviewDto> {
    const set: Partial<Review> = {};
    if (dto.rating !== undefined) set.rating = dto.rating;
    if (dto.comment !== undefined) set.comment = dto.comment;
    const review = await this.reviews
      .findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: true })
      .lean()
      .exec();
    if (!review) throw new NotFoundException('Review not found');
    await this.recalculate(review.hotelId);
    return this.toDto(review as ReviewRow);
  }

  /** DELETE /api/reviews/:id (owner checked by @CheckOwnership). */
  async remove(id: string): Promise<void> {
    const review = await this.reviews.findByIdAndDelete(id).lean().exec();
    if (!review) throw new NotFoundException('Review not found');
    await this.recalculate(review.hotelId);
  }

  /** GET /api/hotels/:id/reviews (HTL-24): public, newest first, 10 per page. */
  async listForHotel(hotelId: string, page: number): Promise<HotelReviewsDto> {
    const hotel = await this.hotels
      .findById(hotelId, { averageRating: 1, ratingCount: 1 })
      .lean()
      .exec();
    if (!hotel) throw new NotFoundException('Hotel not found');
    const result = await paginate(
      this.reviews,
      { hotelId: new Types.ObjectId(hotelId), hiddenAt: null },
      { page, sort: { createdAt: -1 } },
    );
    const items = await Promise.all(
      result.items.map((r) => this.toDto(r as ReviewRow)),
    );
    return {
      averageRating: hotel.averageRating,
      ratingCount: hotel.ratingCount,
      items,
      meta: result.meta,
    };
  }

  /**
   * HTL-23: "the hotel's average rating is recalculated". Also used when an
   * admin hides or deletes a review (GEN-10). Hidden reviews don't count.
   */
  async recalculate(hotelId: Types.ObjectId | string): Promise<void> {
    const id = new Types.ObjectId(String(hotelId));
    const [stats] = await this.reviews
      .aggregate<{ avg: number; count: number }>([
        { $match: { hotelId: id, hiddenAt: null } },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ])
      .exec();
    await this.hotels
      .updateOne(
        { _id: id },
        {
          $set: {
            averageRating: stats ? Math.round(stats.avg * 100) / 100 : null, // null = unrated (HTL-12)
            ratingCount: stats?.count ?? 0,
          },
        },
      )
      .exec();
  }

  private async toDto(r: ReviewRow): Promise<ReviewDto> {
    const author = await this.users
      .findById(r.userId, { name: 1, status: 1 })
      .lean()
      .exec();
    return {
      id: r._id.toString(),
      hotelId: r.hotelId.toString(),
      bookingId: r.bookingId.toString(),
      rating: r.rating,
      comment: r.comment,
      // ACC-12: reviews of deactivated users are shown as "Deleted user".
      author: {
        name:
          author && author.status !== UserStatus.DEACTIVATED
            ? author.name
            : DELETED_USER,
      },
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}

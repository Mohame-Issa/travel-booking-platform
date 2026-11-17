import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module.js';
import { HotelsCatalogueModule } from '../hotels/hotels-catalogue.module.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';
import { Review, ReviewSchema } from './schemas/review.schema.js';

/**
 * Hotel reviews (HTL-23, HTL-24). Taken over from Omar Rashed's part.
 * Uses Mohamed Hashad's HotelBooking and Yassin Shawr's Hotel models.
 * Exports ReviewsService so admin moderation (GEN-10) can recalculate ratings.
 */
@Module({
  imports: [
    HotelsCatalogueModule, // Hotel model (averageRating, ratingCount)
    HotelBookingsModule, // HotelBooking model
    MongooseModule.forFeature([{ name: Review.name, schema: ReviewSchema }]),
  ],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService, MongooseModule],
})
export class ReviewsModule {}

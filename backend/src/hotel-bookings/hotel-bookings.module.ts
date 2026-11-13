import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  HOTEL_BOOKING_LIFECYCLE,
  HOTEL_BOOKING_PAYMENT_READER,
  HOTEL_UPCOMING_BOOKINGS_CHECKER,
} from '../common/interfaces/index.js';
import { HotelsCatalogueModule } from '../hotels/hotels-catalogue.module.js';
import { HotelBookingsController } from './hotel-bookings.controller.js';
import { HotelBookingsService } from './hotel-bookings.service.js';
import {
  HotelBooking,
  HotelBookingSchema,
} from './schemas/hotel-booking.schema.js';

/**
 * GEN-11 hotel reservations. Global so payments (Youssef) and accounts (Amr) get the
 * hotel tokens; exports the HotelBooking model for Omar's cancel endpoint and reviews.
 */
@Global()
@Module({
  imports: [
    HotelsCatalogueModule,
    MongooseModule.forFeature([
      { name: HotelBooking.name, schema: HotelBookingSchema },
    ]),
  ],
  controllers: [HotelBookingsController],
  providers: [
    HotelBookingsService,
    { provide: HOTEL_BOOKING_LIFECYCLE, useExisting: HotelBookingsService },
    {
      provide: HOTEL_BOOKING_PAYMENT_READER,
      useExisting: HotelBookingsService,
    },
    {
      provide: HOTEL_UPCOMING_BOOKINGS_CHECKER,
      useExisting: HotelBookingsService,
    },
  ],
  exports: [
    HotelBookingsService,
    HOTEL_BOOKING_LIFECYCLE,
    HOTEL_BOOKING_PAYMENT_READER,
    HOTEL_UPCOMING_BOOKINGS_CHECKER,
    MongooseModule,
  ],
})
export class HotelBookingsModule {}

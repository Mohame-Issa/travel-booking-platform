import { Module } from '@nestjs/common';
import { HotelBookingCancellationController } from './hotel-booking-cancellation.controller.js';
import { HotelBookingCancellationService } from './hotel-booking-cancellation.service.js';

// No imports needed: HotelBookingsModule is global and exports the HotelBooking model,
// and the notification/lifecycle/refund services are provided globally by their owners.
@Module({
  controllers: [HotelBookingCancellationController],
  providers: [HotelBookingCancellationService],
})
export class HotelBookingCancellationModule {}


import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module.js';
import { AirlinesModule } from '../airlines/airlines.module.js';
import { HotelsCatalogueModule } from '../hotels/hotels-catalogue.module.js';
import { UsersModule } from '../users/users.module.js';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module.js';

import {
  FlightBooking,
  FlightBookingSchema,
} from '../flight-bookings/schemas/flight-booking.schema.js';

import {
  HotelBooking,
  HotelBookingSchema,
} from '../hotel-bookings/schemas/hotel-booking.schema.js';

import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    AirlinesModule,
    HotelsCatalogueModule,
    FlightBookingsModule,
    MongooseModule.forFeature([
      { name: FlightBooking.name, schema: FlightBookingSchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}

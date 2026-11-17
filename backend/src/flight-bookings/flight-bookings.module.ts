import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Airline,
  AirlinePolicy,
  AirlinePolicySchema,
  AirlineSchema,
  Airport,
  AirportSchema,
  CabinInventory,
  CabinInventorySchema,
  FLIGHT_BOOKING_LIFECYCLE,
  FLIGHT_BOOKING_PAYMENT_READER,
  FLIGHT_UPCOMING_BOOKINGS_CHECKER,
  Flight,
  FlightSchema,
  FlightsModule,
  FLIGHT_BOOKING_HISTORY_READER,
} from './flight-bookings.imports.js';
import { FlightBookingEventsListener } from './flight-booking-events.listener.js';
import { FlightBookingsController } from './flight-bookings.controller.js';
import { FlightBookingsService } from './flight-bookings.service.js';
import { FlightPassengersController } from './flight-passengers.controller.js';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema.js';
import {
  SeatAssignment,
  SeatAssignmentSchema,
} from './schemas/seat-assignment.schema.js';
import { SeatsController } from './seats.controller.js';
import { FlightChangesController } from './flight-changes.controller.js';
import { FlightChangesService } from './flight-changes.service.js';
import {
  FlightChange,
  FlightChangeSchema,
} from './schemas/flight-change.schema.js';
import { SeatsService } from './seats.service.js';

@Global()
@Module({
  imports: [
    FlightsModule, // provides FlightEventsService (must export it; ask Yassin if Nest complains)
    MongooseModule.forFeature([
      { name: FlightBooking.name, schema: FlightBookingSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: CabinInventory.name, schema: CabinInventorySchema },
      { name: AirlinePolicy.name, schema: AirlinePolicySchema },
      { name: Airline.name, schema: AirlineSchema },
      { name: Airport.name, schema: AirportSchema },
      { name: SeatAssignment.name, schema: SeatAssignmentSchema }, // FLT-28
      { name: FlightChange.name, schema: FlightChangeSchema }, // FLT-27
    ]),
  ],
  controllers: [
    FlightBookingsController,
    FlightPassengersController,
    SeatsController,
    FlightChangesController,
  ],
  providers: [
    FlightBookingsService,
    SeatsService,
    FlightChangesService,
    FlightBookingEventsListener,
    { provide: FLIGHT_BOOKING_LIFECYCLE, useExisting: FlightBookingsService },
    {
      provide: FLIGHT_UPCOMING_BOOKINGS_CHECKER,
      useExisting: FlightBookingsService,
    },
    {
      provide: FLIGHT_BOOKING_PAYMENT_READER,
      useExisting: FlightBookingsService,
    },
    {
      provide: FLIGHT_BOOKING_HISTORY_READER,
      useExisting: FlightBookingsService,
    },
  ],
  exports: [
    FLIGHT_BOOKING_LIFECYCLE,
    FLIGHT_UPCOMING_BOOKINGS_CHECKER,
    FLIGHT_BOOKING_PAYMENT_READER,
    FLIGHT_BOOKING_HISTORY_READER,
    FlightBookingsService,
  ],
})
export class FlightBookingsModule {}

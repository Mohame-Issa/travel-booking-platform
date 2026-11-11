import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesModule } from '../airlines/airlines.module.js';
import { AirportsModule } from '../airports/airports.module.js';
import { FlightsController } from './flights.controller.js';
import { FlightsService } from './flights.service.js';
import { FlightEventsService } from './flight-events.service.js';
import {
  FLIGHT_BOOKING_HISTORY_READER,
  PendingFlightBookingHistoryReader,
} from './flight-booking-history.interface.js';
import {
  CabinInventory,
  CabinInventorySchema,
} from './schemas/cabin-inventory.schema.js';
import { Flight, FlightSchema } from './schemas/flight.schema.js';
import {
  FlightEvent,
  FlightEventSchema,
} from './schemas/flight-event.schema.js';

@Module({
  imports: [
    AirlinesModule,
    AirportsModule,
    MongooseModule.forFeature([
      { name: Flight.name, schema: FlightSchema },
      { name: CabinInventory.name, schema: CabinInventorySchema },
      { name: FlightEvent.name, schema: FlightEventSchema },
    ]),
  ],
  controllers: [FlightsController],
  providers: [
    FlightsService,
    FlightEventsService,
    {
      provide: FLIGHT_BOOKING_HISTORY_READER,
      useClass: PendingFlightBookingHistoryReader,
    },
  ],
  exports: [FlightsService, FlightEventsService, MongooseModule],
})
export class FlightsModule {}

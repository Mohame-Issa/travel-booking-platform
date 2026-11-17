import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../seed/reference-data.module.js';
import { ItinerariesController } from './itineraries.controller.js';
import { ItinerariesService } from './itineraries.service.js';
import { Activity, ActivitySchema } from './schemas/activity.schema.js';
import {
  BudgetEntry,
  BudgetEntrySchema,
} from './schemas/budget-entry.schema.js';
import {
  ExchangeRate,
  ExchangeRateSchema,
} from './schemas/exchange-rate.schema.js';
import {
  ItineraryDay,
  ItineraryDaySchema,
} from './schemas/itinerary-day.schema.js';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema.js';
import {
  TransportCost,
  TransportCostSchema,
} from './schemas/transport-cost.schema.js';

/**
 * Itineraries and budgets (ITN-01..ITN-26). Taken over from Nada Gad's part.
 * Exports the models so Omar Rashed's public search and cloning (ITN-21) can
 * read and copy itineraries.
 */
@Module({
  imports: [
    ReferenceDataModule, // Country and City lists (GEN-12)
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
      { name: ItineraryDay.name, schema: ItineraryDaySchema },
      { name: Activity.name, schema: ActivitySchema },
      { name: BudgetEntry.name, schema: BudgetEntrySchema },
      { name: TransportCost.name, schema: TransportCostSchema },
      { name: ExchangeRate.name, schema: ExchangeRateSchema },
    ]),
  ],
  controllers: [ItinerariesController],
  providers: [ItinerariesService],
  exports: [MongooseModule, ItinerariesService],
})
export class ItinerariesModule {}

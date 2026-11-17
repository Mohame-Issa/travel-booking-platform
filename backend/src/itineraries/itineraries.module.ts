import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlightsModule } from '../flights/flights.module.js';
import { HotelsCatalogueModule } from '../hotels/hotels-catalogue.module.js';
import { ReferenceDataModule } from '../seed/reference-data.module.js';
import {
  BudgetEntriesController,
  TransportCostsController,
} from './budget-items.controller.js';
import { BudgetsService } from './budgets.service.js';
import { ExchangeRatesService } from './exchange-rates.service.js';
import { ItineraryBudgetController } from './itinerary-budget.controller.js';
import { ItinerarySearchService } from './itinerary-search.service.js';
import { PublicItinerariesController } from './public-itineraries.controller.js';
import { PublicItinerariesService } from './public-itineraries.service.js';
import { ActivitiesController } from './activities.controller.js';
import { ActivitiesService } from './activities.service.js';
import { ItinerariesController } from './itineraries.controller.js';
import { ItineraryDaysController } from './itinerary-days.controller.js';
import { ItineraryDaysService } from './itinerary-days.service.js';
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
    ReferenceDataModule, // Country, City and Airport lists (GEN-12)
    FlightsModule, // Yassin's flight search, reused by ITN-26
    HotelsCatalogueModule, // Yassin's hotel search, reused by ITN-25
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
      { name: ItineraryDay.name, schema: ItineraryDaySchema },
      { name: Activity.name, schema: ActivitySchema },
      { name: BudgetEntry.name, schema: BudgetEntrySchema },
      { name: TransportCost.name, schema: TransportCostSchema },
      { name: ExchangeRate.name, schema: ExchangeRateSchema },
    ]),
  ],
  controllers: [
    PublicItinerariesController, // first: its /public/... routes are literal
    ItinerariesController,
    ItineraryDaysController,
    ActivitiesController,
    ItineraryBudgetController,
    BudgetEntriesController,
    TransportCostsController,
  ],
  providers: [
    ItinerariesService,
    ItineraryDaysService,
    ActivitiesService,
    BudgetsService,
    ExchangeRatesService,
    ItinerarySearchService,
    PublicItinerariesService,
  ],
  exports: [MongooseModule, ItinerariesService],
})
export class ItinerariesModule {}

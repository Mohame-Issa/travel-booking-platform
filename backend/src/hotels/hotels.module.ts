import { Module } from '@nestjs/common';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module.js';
import { ReferenceDataModule } from '../seed/reference-data.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { HotelsCatalogueModule } from './hotels-catalogue.module.js';
import { HotelsController } from './hotels.controller.js';
import { HotelsService } from './hotels.service.js';

/**
 * Hotel management (Mohamed Hashad). Reuses Yassin's catalogue models; imported after
 * HotelsCatalogueModule so GET /api/hotels/search is matched before GET /api/hotels/:id.
 */
@Module({
  imports: [
    HotelsCatalogueModule,
    HotelBookingsModule,
    ReferenceDataModule,
    UploadsModule,
  ],
  controllers: [HotelsController],
  providers: [HotelsService],
})
export class HotelsModule {}

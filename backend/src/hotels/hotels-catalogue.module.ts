import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../seed/reference-data.module.js';
import { HotelsSearchController } from './hotels-search.controller.js';
import { HotelsSearchService } from './hotels-search.service.js';
import { Hotel, HotelSchema } from './schemas/hotel.schema.js';
import {
  HotelPolicy,
  HotelPolicySchema,
} from './schemas/hotel-policy.schema.js';
import {
  RoomAvailability,
  RoomAvailabilitySchema,
} from './schemas/room-availability.schema.js';
import { Room, RoomSchema } from './schemas/room.schema.js';

@Module({
  imports: [
    ReferenceDataModule,
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: RoomAvailability.name, schema: RoomAvailabilitySchema },
      { name: HotelPolicy.name, schema: HotelPolicySchema },
    ]),
  ],
  controllers: [HotelsSearchController],
  providers: [HotelsSearchService],
  exports: [HotelsSearchService, MongooseModule],
})
export class HotelsCatalogueModule {}

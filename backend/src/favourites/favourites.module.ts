import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Hotel, HotelSchema } from '../hotels/schemas/hotel.schema.js';
import { ItinerariesModule } from '../itineraries/itineraries.module.js';
import { FavouritesController } from './favourites.controller.js';
import { FavouritesService } from './favourites.service.js';
import { Favourite, FavouriteSchema } from './schemas/favourite.schema.js';

/** BON-02 (bonus): favourites. */
@Module({
  imports: [
    ItinerariesModule, // Itinerary model + the public-visibility rule (ITN-21)
    MongooseModule.forFeature([
      { name: Favourite.name, schema: FavouriteSchema },
      { name: Hotel.name, schema: HotelSchema },
    ]),
  ],
  controllers: [FavouritesController],
  providers: [FavouritesService],
})
export class FavouritesModule {}

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Airport, AirportSchema } from '../airports/schemas/airport.schema.js';
import {
  Attraction,
  AttractionSchema,
  City,
  CitySchema,
  Country,
  CountrySchema,
} from './schemas/reference-data.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Airport.name, schema: AirportSchema },
      { name: Country.name, schema: CountrySchema },
      { name: City.name, schema: CitySchema },
      { name: Attraction.name, schema: AttractionSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class ReferenceDataModule {}

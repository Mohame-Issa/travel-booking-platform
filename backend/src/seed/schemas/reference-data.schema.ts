import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies.js';

// GEN-12: preserve the official identifiers rather than generating ObjectIds.
@Schema({ collection: 'countries', timestamps: true })
export class Country {
  @Prop({ type: String, required: true }) _id: string;
  @Prop({ required: true, unique: true }) code: string;
  @Prop({ required: true }) name: string;
  @Prop({ required: true, enum: SUPPORTED_CURRENCIES }) currency: string;
}
export const CountrySchema = SchemaFactory.createForClass(Country);
CountrySchema.pre('validate', function () {
  if (this._id !== this.code)
    this.invalidate('code', 'Country primary key must equal the official code');
});

@Schema({ collection: 'cities', timestamps: true })
export class City {
  @Prop({ type: String, required: true }) _id: string;
  @Prop({ required: true, unique: true }) cityId: string;
  @Prop({ required: true }) name: string;
  @Prop({ type: String, ref: 'Country', required: true, index: true })
  countryCode: string;
}
export const CitySchema = SchemaFactory.createForClass(City);
CitySchema.pre('validate', function () {
  if (this._id !== this.cityId)
    this.invalidate(
      'cityId',
      'City primary key must equal the official city ID',
    );
});

@Schema({ collection: 'attractions', timestamps: true })
export class Attraction {
  @Prop({ type: String, required: true }) _id: string;
  @Prop({ required: true, unique: true }) attractionId: string;
  @Prop({ required: true }) name: string;
  @Prop({ type: String, ref: 'City', required: true, index: true })
  cityId: string;
}
export const AttractionSchema = SchemaFactory.createForClass(Attraction);
AttractionSchema.pre('validate', function () {
  if (this._id !== this.attractionId)
    this.invalidate(
      'attractionId',
      'Attraction primary key must equal the official attraction ID',
    );
});

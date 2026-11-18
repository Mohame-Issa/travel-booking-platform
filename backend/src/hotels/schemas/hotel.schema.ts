import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { ProviderStatus } from '../../flights/catalogue.constants.js';
import { PLATFORM_CURRENCY } from '../../common/constants/currencies.js';

@Schema({ collection: 'hotels', timestamps: true })
export class Hotel {
  @Prop({ type: String, unique: true, sparse: true, immutable: true })
  seedKey?: string;
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ required: true }) address: string;
  @Prop({ type: String, ref: 'City', required: true, index: true })
  cityId: string;
  @Prop({ type: String, ref: 'Country', required: true, index: true })
  countryCode: string;
  @Prop({ default: '' }) description: string;
  @Prop({
    type: [String],
    default: [],
    validate: {
      validator: (photos: string[]) => photos.length <= 5,
      message: 'At most five hotel photos (GEN-08)',
    },
  })
  photos: string[];
  @Prop({ required: true, min: 1, max: 5, validate: Number.isInteger })
  starClass: number;
  @Prop({ type: [String], default: [] }) amenities: string[];
  // PAY-04: Room.pricePerNight is denominated in this platform currency.
  @Prop({ required: true, uppercase: true, enum: [PLATFORM_CURRENCY] })
  currency: string;
  @Prop({
    type: String,
    enum: Object.values(ProviderStatus),
    default: ProviderStatus.ACTIVE,
    required: true,
    index: true,
  })
  status: ProviderStatus;
  // HTL-12: null means unrated and must be excluded by a rating filter.
  @Prop({ type: Number, min: 1, max: 5, default: null }) averageRating:
    number | null;
  @Prop({ default: 0, min: 0, validate: Number.isInteger }) ratingCount: number;
}
export type HotelDocument = HydratedDocument<Hotel>;
export const HotelSchema = SchemaFactory.createForClass(Hotel);

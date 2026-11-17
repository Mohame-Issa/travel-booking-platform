import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Schema as MongooseSchema,
  Types,
  type HydratedDocument,
} from 'mongoose';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies.js';

/**
 * Intercity transport cost (ITN-16): mode, from-city, to-city, amount,
 * currency, day. Collection: "transportcosts".
 */
@Schema({ timestamps: true, collection: 'transportcosts' })
export class TransportCost {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Itinerary',
    required: true,
    index: true,
  })
  itineraryId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'ItineraryDay',
    required: true,
    index: true,
  })
  dayId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** e.g. "train", "bus", "flight" (the requirement does not fix a list). */
  @Prop({ type: String, required: true, trim: true })
  mode: string;

  @Prop({ type: String, ref: 'City', required: true })
  fromCityId: string;

  @Prop({ type: String, ref: 'City', required: true })
  toCityId: string;

  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({ type: String, required: true, enum: SUPPORTED_CURRENCIES })
  currency: string;

  createdAt: Date;
  updatedAt: Date;
}

export type TransportCostDocument = HydratedDocument<TransportCost>;
export const TransportCostSchema = SchemaFactory.createForClass(TransportCost);

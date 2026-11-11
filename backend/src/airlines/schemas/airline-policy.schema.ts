import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types, type HydratedDocument } from 'mongoose';

import {
  CancellationTier,
  CancellationTierSchema,
  uniqueTierThresholds,
} from './cancellation-tier.schema.js';

@Schema({ collection: 'airlinepolicies', timestamps: true })
export class AirlinePolicy {
  @Prop({
    type: MongoSchema.Types.ObjectId,
    ref: 'Airline',
    required: true,
    unique: true,
  })
  airlineId: Types.ObjectId;
  @Prop({ type: Number, min: Number.MIN_VALUE, default: null }) extraBagPrice:
    number | null;
  @Prop({ min: 0, default: 0, validate: Number.isInteger })
  maxExtraBags: number;
  @Prop({
    type: [CancellationTierSchema],
    default: [],
    validate: {
      validator: uniqueTierThresholds,
      message: 'Cancellation thresholds must be unique (FLT-09)',
    },
  })
  cancellationTiers: CancellationTier[];
}
export type AirlinePolicyDocument = HydratedDocument<AirlinePolicy>;
export const AirlinePolicySchema = SchemaFactory.createForClass(AirlinePolicy);

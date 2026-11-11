import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types, type HydratedDocument } from 'mongoose';
import {
  CancellationTier,
  CancellationTierSchema,
  uniqueTierThresholds,
} from '../../airlines/schemas/cancellation-tier.schema.js';

@Schema({ collection: 'hotelpolicies', timestamps: true })
export class HotelPolicy {
  @Prop({
    type: MongoSchema.Types.ObjectId,
    ref: 'Hotel',
    required: true,
    unique: true,
  })
  hotelId: Types.ObjectId;
  @Prop({ required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ })
  checkInTime: string;
  @Prop({ required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ })
  checkOutTime: string;
  @Prop({
    type: [CancellationTierSchema],
    default: [],
    validate: {
      validator: uniqueTierThresholds,
      message: 'Cancellation thresholds must be unique (HTL-10)',
    },
  })
  cancellationTiers: CancellationTier[];
}
export type HotelPolicyDocument = HydratedDocument<HotelPolicy>;
export const HotelPolicySchema = SchemaFactory.createForClass(HotelPolicy);

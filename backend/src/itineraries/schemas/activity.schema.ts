import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Schema as MongooseSchema,
  Types,
  type HydratedDocument,
} from 'mongoose';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies.js';

/** An image attached through the shared upload service (GEN-08, ITN-12). */
@Schema({ _id: false })
export class ActivityImage {
  /** Id of the Upload document (Mohamed Hashad's uploads module). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Upload', required: true })
  imageId: Types.ObjectId;

  @Prop({ type: String, required: true })
  url: string;
}
const ActivityImageSchema = SchemaFactory.createForClass(ActivityImage);

/**
 * An activity on an itinerary day (ITN-10). Collection: "activities".
 * Its optional cost counts under the "activities" budget category (ITN-14).
 */
@Schema({ timestamps: true, collection: 'activities' })
export class Activity {
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

  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, default: '' })
  description: string;

  /** ITN-10: optional time, "HH:mm". */
  @Prop({ type: String, default: null, match: /^([01]\d|2[0-3]):[0-5]\d$/ })
  time: string | null;

  /** ITN-10: optional cost (non-negative), in a supported currency. */
  @Prop({ type: Number, default: null, min: 0 })
  cost: number | null;

  @Prop({ type: String, default: null, enum: [...SUPPORTED_CURRENCIES, null] })
  currency: string | null;

  /** ITN-12 / GEN-08: at most 5 (enforced by the upload service). */
  @Prop({ type: [ActivityImageSchema], default: [] })
  images: ActivityImage[];

  createdAt: Date;
  updatedAt: Date;
}

export type ActivityDocument = HydratedDocument<Activity>;
export const ActivitySchema = SchemaFactory.createForClass(Activity);

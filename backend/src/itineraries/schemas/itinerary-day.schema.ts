import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Schema as MongooseSchema,
  Types,
  type HydratedDocument,
} from 'mongoose';

/**
 * One day of an itinerary (ITN-05). Collection: "itinerarydays".
 *
 * The date is NOT stored: it is always startDate + (dayNumber - 1) days, so
 * deleting/reordering days (ITN-07, ITN-08) or changing the start date can
 * never leave a wrong date behind. Only dayNumber is renumbered.
 */
@Schema({ timestamps: true, collection: 'itinerarydays' })
export class ItineraryDay {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Itinerary',
    required: true,
    index: true,
  })
  itineraryId: Types.ObjectId;

  /** Owner, copied from the itinerary, so @CheckOwnership works on day routes. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** 1..60, sequential with no gaps (ITN-05, ITN-07, ITN-08). */
  @Prop({ type: Number, required: true, min: 1, max: 60 })
  dayNumber: number;

  /** ITN-09: every day has a city from Cities.csv (e.g. "cairo"). */
  @Prop({ type: String, ref: 'City', required: true })
  cityId: string;

  @Prop({ type: String, default: '' })
  notes: string;

  createdAt: Date;
  updatedAt: Date;
}

export type ItineraryDayDocument = HydratedDocument<ItineraryDay>;
export const ItineraryDaySchema = SchemaFactory.createForClass(ItineraryDay);
ItineraryDaySchema.index({ itineraryId: 1, dayNumber: 1 });

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Schema as MongooseSchema,
  Types,
  type HydratedDocument,
} from 'mongoose';

export enum ItineraryVisibility {
  PRIVATE = 'private',
  PUBLIC = 'public',
}

/** ITN-21 attribution: set only on clones (Omar Rashed's clone endpoint). */
@Schema({ _id: false })
export class ClonedFrom {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Itinerary',
    required: true,
  })
  itineraryId: Types.ObjectId;

  /** Original author, credited on the clone. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId;
}
const ClonedFromSchema = SchemaFactory.createForClass(ClonedFrom);

/**
 * A trip plan (ITN-01). Collection: "itineraries".
 * Days, activities, budget entries and transport costs live in their own
 * collections and point back here with `itineraryId`.
 */
@Schema({ timestamps: true, collection: 'itineraries' })
export class Itinerary {
  /** Owner (ACC-11: private itineraries are visible only to them). */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  /** ITN-01: required, max 100 characters. */
  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  title: string;

  /** ITN-01: one or more country codes from Countries.csv (e.g. "EG"). */
  @Prop({
    type: [String],
    required: true,
    validate: {
      validator: (v: string[]) => v.length >= 1,
      message: 'An itinerary needs at least one country',
    },
  })
  countries: string[];

  /** ITN-01 / ITN-05: day N is on startDate + (N - 1) days. UTC midnight. */
  @Prop({ type: Date, required: true })
  startDate: Date;

  /** ITN-01: private by default. ITN-20: public = shown in shared search, read-only to others. */
  @Prop({
    type: String,
    enum: Object.values(ItineraryVisibility),
    default: ItineraryVisibility.PRIVATE,
    index: true,
  })
  visibility: ItineraryVisibility;

  /** Number of days (ITN-03 list), kept in sync by the day endpoints. Max 60 (ITN-05). */
  @Prop({ type: Number, default: 0, min: 0, max: 60 })
  dayCount: number;

  @Prop({ type: ClonedFromSchema, default: null })
  clonedFrom: ClonedFrom | null;

  createdAt: Date;
  updatedAt: Date;
}

export type ItineraryDocument = HydratedDocument<Itinerary>;
export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);

/** ITN-03: "my itineraries, most recently updated first". */
ItinerarySchema.index({ userId: 1, updatedAt: -1 });

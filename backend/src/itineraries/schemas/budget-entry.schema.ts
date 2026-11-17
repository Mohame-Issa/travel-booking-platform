import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Schema as MongooseSchema,
  Types,
  type HydratedDocument,
} from 'mongoose';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies.js';

/**
 * ITN-14 categories. Activity costs (ITN-10) are added to "activities" and
 * intercity transport (ITN-16) is reported separately in the totals.
 */
export enum BudgetCategory {
  FOOD = 'food',
  ACCOMMODATION = 'accommodation',
  IN_CITY_TRANSPORT = 'in_city_transport',
  ACTIVITIES = 'activities',
}

/** A non-negative budget amount for one day (ITN-14). Collection: "budgetentries". */
@Schema({ timestamps: true, collection: 'budgetentries' })
export class BudgetEntry {
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

  @Prop({ type: String, enum: Object.values(BudgetCategory), required: true })
  category: BudgetCategory;

  /** ITN-14: non-negative, in `currency` (major units). */
  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  /** ITN-14: "in a selected currency" from the supported list (GEN-12). */
  @Prop({ type: String, required: true, enum: SUPPORTED_CURRENCIES })
  currency: string;

  @Prop({ type: String, default: '' })
  note: string;

  createdAt: Date;
  updatedAt: Date;
}

export type BudgetEntryDocument = HydratedDocument<BudgetEntry>;
export const BudgetEntrySchema = SchemaFactory.createForClass(BudgetEntry);

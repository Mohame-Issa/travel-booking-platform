import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Every Stripe webhook event we have processed. Collection: "stripeevents".
 *
 * Stripe may deliver the same event more than once (retries, or a replay with
 * `stripe events resend`). The unique `eventId` makes processing idempotent:
 * the second insert fails with a duplicate key, so the event is skipped and a
 * booking can never be confirmed or refunded twice.
 */
@Schema({ timestamps: true, collection: 'stripeevents' })
export class StripeEvent {
  /** Stripe event id ("evt_..."). */
  @Prop({ type: String, required: true, unique: true })
  eventId: string;

  /** e.g. "payment_intent.succeeded". */
  @Prop({ type: String, required: true })
  type: string;

  createdAt: Date;
  updatedAt: Date;
}

export type StripeEventDocument = HydratedDocument<StripeEvent>;
export const StripeEventSchema = SchemaFactory.createForClass(StripeEvent);

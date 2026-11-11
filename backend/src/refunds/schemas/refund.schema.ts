import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type {
  BookingType,
  RefundReason,
  RefundStatus,
} from '../../common/interfaces/index.js';

/**
 * A refund of a booking's payment (PAY-03). Collection: "refunds".
 *
 * Statuses follow the shared RefundStatus type:
 *   pending   -> shown as "Pending"  (sent to Stripe, not final yet)
 *   succeeded -> shown as "Refunded"
 *   failed    -> shown as "Failed"
 */
@Schema({ timestamps: true, collection: 'refunds' })
export class Refund {
  @Prop({ type: Types.ObjectId, ref: 'Payment', required: true })
  paymentId: Types.ObjectId;

  /** Owner of the booking (copied from the payment), for ownership checks. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: ['flight', 'hotel'], required: true })
  bookingType: BookingType;

  @Prop({ type: Types.ObjectId, required: true })
  bookingId: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['user_cancellation', 'provider_cancellation', 'flight_cancelled'],
    required: true,
  })
  reason: RefundReason;

  /** User who cancelled; null for system-triggered refunds (FLT-06). */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  requestedBy: Types.ObjectId | null;

  /**
   * "Applicable policy information" (project description, Payments entity):
   * the percentage applied and the tier that produced it.
   * PAY-03: provider-initiated cancellations are 100%.
   */
  @Prop({ type: Number, required: true, min: 0, max: 100 })
  refundPercentage: number;

  /** Whole days left before departure / check-in when cancelled. null if fullRefund. */
  @Prop({ type: Number, default: null })
  daysBeforeStart: number | null;

  /** Threshold of the tier used (FLT-09 rule). null if no tier applied or fullRefund. */
  @Prop({ type: Number, default: null })
  appliedTierDaysBefore: number | null;

  /** Refund amount in MINOR units. 0 if the policy gives no refund. */
  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: Number.isInteger,
      message: 'amountMinor must be an integer',
    },
  })
  amountMinor: number;

  @Prop({
    type: String,
    required: true,
    uppercase: true,
    minlength: 3,
    maxlength: 3,
  })
  currency: string;

  @Prop({
    type: String,
    enum: ['pending', 'succeeded', 'failed'],
    default: 'pending',
  })
  status: RefundStatus;

  /** Stripe refund id ("re_..."). Absent when the amount is 0 (PAY-03). */
  @Prop({ type: String })
  stripeRefundId?: string;

  createdAt: Date;
  updatedAt: Date;
}

export type RefundDocument = HydratedDocument<Refund>;
export const RefundSchema = SchemaFactory.createForClass(Refund);

/**
 * One refund per booking: partial cancellation is not supported (HTL-21) and a
 * cancelled booking cannot be cancelled again. A second createRefund() call for
 * the same booking hits this index, so the user cannot be refunded twice.
 */
RefundSchema.index({ bookingType: 1, bookingId: 1 }, { unique: true });

/** Webhook "refund.updated" looks refunds up by Stripe id. */
RefundSchema.index(
  { stripeRefundId: 1 },
  {
    unique: true,
    partialFilterExpression: { stripeRefundId: { $type: 'string' } },
  },
);

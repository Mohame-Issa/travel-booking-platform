import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, HydratedDocument, Types } from 'mongoose';
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
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Payment', required: true })
  paymentId: Types.ObjectId;

  /** Owner of the booking (copied from the payment), for ownership checks. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: ['flight', 'hotel'], required: true })
  bookingType: BookingType;

  /** The flight booking or hotel reservation (for a late payment of a flight change: the change). */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  bookingId: Types.ObjectId;

  /** FLT-27 (bonus): the flight change whose lower fare this refunds. */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  changeId: Types.ObjectId | null;

  /**
   * What this refund is for, unique (see the index below):
   *   cancel:<bookingId>:<paymentId>  cancellation (PAY-03), one per payment
   *   fare:<changeId>:<paymentId>     lower fare after a flight change (FLT-27)
   *   late:<paymentId>                payment that arrived after its hold expired
   * A booking changed to a dearer flight has two payments, so its
   * cancellation refund may be split over both.
   */
  @Prop({ type: String, required: true })
  refundKey: string;

  /**
   * Shared RefundReason values, plus 'late_payment' (ours only): the payment
   * succeeded after the hold expired, so the booking could not be confirmed
   * (GEN-11) and the money is given back in full. 'fare_difference' (FLT-27):
   * the user changed to a cheaper flight.
   */
  @Prop({
    type: String,
    enum: [
      'user_cancellation',
      'provider_cancellation',
      'flight_cancelled',
      'late_payment',
      'fare_difference',
    ],
    required: true,
  })
  reason: RefundReason | 'late_payment' | 'fare_difference';

  /** User who cancelled; null for system-triggered refunds (FLT-06). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
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

  /**
   * Refund amount in MINOR units. Always > 0: PAY-03 creates a refund only
   * for a positive amount (a 0% cancellation has no refund record).
   */
  @Prop({
    type: Number,
    required: true,
    min: 1,
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

  /** Stripe refund id ("re_..."). Absent if the Stripe call failed. */
  @Prop({ type: String })
  stripeRefundId?: string;

  createdAt: Date;
  updatedAt: Date;
}

export type RefundDocument = HydratedDocument<Refund>;
export const RefundSchema = SchemaFactory.createForClass(Refund);

/**
 * The database refuses a second refund for the same purpose, so a booking can
 * never be refunded twice, even by two parallel requests. (This replaced the
 * older one-refund-per-booking index; RefundsService drops that one on start.)
 */
RefundSchema.index(
  { refundKey: 1 },
  { unique: true, partialFilterExpression: { refundKey: { $type: 'string' } } },
);

/** Webhook "refund.updated" looks refunds up by Stripe id. */
RefundSchema.index(
  { stripeRefundId: 1 },
  {
    unique: true,
    partialFilterExpression: { stripeRefundId: { $type: 'string' } },
  },
);

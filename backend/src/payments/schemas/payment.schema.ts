import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { BookingType } from '../../common/interfaces/index.js';
import { PaymentStatus } from '../payments.constants.js';

/**
 * One Stripe payment for one flight booking or hotel reservation (PAY-01).
 * Collection: "payments".
 *
 * PAY-01: only the Stripe payment ID, amount, currency and status are stored.
 * No card number, expiry, CVC or cardholder name ever reaches this backend:
 * the card is entered in Stripe Elements on the frontend.
 */
@Schema({ timestamps: true, collection: 'payments' })
export class Payment {
  /** Owner of the booking. Used for the ownership check (ACC-11). */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: ['flight', 'hotel'], required: true })
  bookingType: BookingType;

  /** _id of the FlightBooking or HotelBooking (depending on bookingType). */
  @Prop({ type: Types.ObjectId, required: true })
  bookingId: Types.ObjectId;

  /** Stripe PaymentIntent id ("pi_..."). The webhook finds the payment by it. */
  @Prop({ type: String, required: true, unique: true })
  stripePaymentIntentId: string;

  /**
   * Amount in MINOR units (e.g. cents), computed by the server from the
   * booking total, never sent by the client.
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

  /** ISO 4217 code, upper case. PAY-04: the single platform currency. */
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
    enum: Object.values(PaymentStatus),
    default: PaymentStatus.PENDING,
    index: true,
  })
  status: PaymentStatus;

  /**
   * Copy of the booking's hold expiry (FLT-22 / HTL-18: 10 minutes).
   * The expiry job cancels the PaymentIntent after this time (PAY-01).
   */
  @Prop({ type: Date, required: true, index: true })
  holdExpiresAt: Date;

  /** When the webhook verified success. */
  @Prop({ type: Date, default: null })
  succeededAt: Date | null;

  /**
   * When we asked the booking module to release the held seats/rooms after
   * the hold expired. null = not released yet, so the expiry job retries.
   */
  @Prop({ type: Date, default: null })
  releasedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type PaymentDocument = HydratedDocument<Payment>;
export const PaymentSchema = SchemaFactory.createForClass(Payment);

/**
 * At most ONE payment per booking. A retry (POST /payments/:id/retry) reuses
 * the same document and the same PaymentIntent, so a booking can never be
 * charged twice by two parallel "Pay" clicks.
 */
PaymentSchema.index({ bookingType: 1, bookingId: 1 }, { unique: true });

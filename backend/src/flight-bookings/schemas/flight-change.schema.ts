import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types, type HydratedDocument } from 'mongoose';
import { CabinClass } from '../flight-bookings.imports.js';

/** FLT-27 lifecycle of one change request. */
export enum FlightChangeStatus {
  /** Seats on the new flight are held for 10 minutes until the difference is paid. */
  PENDING_PAYMENT = 'Pending Payment',
  /** The booking now points at the new flight. */
  APPLIED = 'Applied',
  /** Not paid within the hold; the held seats went back. */
  EXPIRED = 'Expired',
  /** Dropped because the booking or the new flight was cancelled meanwhile. */
  CANCELLED = 'Cancelled',
}

/**
 * FLT-27 (bonus): one request to move a Confirmed flight booking to another
 * flight on the same route and cabin. Collection "flightchanges".
 * Its _id doubles as the "booking id" of the fare-difference payment, so the
 * existing payment flow (policies, PaymentIntent, webhook) is reused as is.
 */
@Schema({ collection: 'flightchanges', timestamps: true })
export class FlightChange {
  @Prop({
    type: MongoSchema.Types.ObjectId,
    ref: 'FlightBooking',
    required: true,
    index: true,
  })
  bookingId: Types.ObjectId;
  @Prop({
    type: MongoSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Airline', required: true })
  airlineId: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Flight', required: true })
  fromFlightId: Types.ObjectId;
  @Prop({
    type: MongoSchema.Types.ObjectId,
    ref: 'Flight',
    required: true,
    index: true,
  })
  toFlightId: Types.ObjectId;
  @Prop({ type: String, enum: Object.values(CabinClass), required: true })
  cabinClass: CabinClass;
  @Prop({ required: true, min: 1 }) seatCount: number;

  // Snapshot of the new flight, copied onto the booking when applied.
  @Prop({ required: true }) toFlightNumber: string;
  @Prop({ required: true }) toDepartureTime: Date;
  @Prop({ required: true }) toArrivalTime: Date;

  @Prop({ required: true }) oldPricePerSeat: number;
  @Prop({ required: true }) newPricePerSeat: number;
  /** (new - old) x seats, major units. Positive = pay, negative = refund. */
  @Prop({ required: true }) fareDifference: number;
  /** What the user pays now: max(0, fareDifference). */
  @Prop({ required: true, min: 0 }) amountDue: number;
  @Prop({ required: true }) currency: string;

  @Prop({
    type: String,
    enum: Object.values(FlightChangeStatus),
    required: true,
  })
  status: FlightChangeStatus;
  @Prop({ type: Date, default: null }) holdExpiresAt: Date | null;
  @Prop({ type: String }) paymentId?: string;
  @Prop({ type: Date }) appliedAt?: Date;
  @Prop({ type: String }) refundId?: string | null;
  @Prop({ type: Number }) refundAmount?: number;
  @Prop({ type: String }) refundStatus?: string;

  createdAt: Date;
  updatedAt: Date;
}
export type FlightChangeDocument = HydratedDocument<FlightChange>;
export const FlightChangeSchema = SchemaFactory.createForClass(FlightChange);
// At most one open (unpaid) change per booking, even with parallel requests.
FlightChangeSchema.index(
  { bookingId: 1 },
  {
    name: 'one_open_change_per_booking',
    unique: true,
    partialFilterExpression: { status: FlightChangeStatus.PENDING_PAYMENT },
  },
);
FlightChangeSchema.index({ status: 1, holdExpiresAt: 1 });

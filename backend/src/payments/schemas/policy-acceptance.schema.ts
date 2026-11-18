import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, HydratedDocument, Types } from 'mongoose';
import type { BookingType } from '../../common/interfaces/index.js';

/** One cancellation tier (FLT-09 / HTL-10). */
@Schema({ _id: false })
export class CancellationTierSnapshot {
  /** Days before departure (flight) or check-in (hotel). Integer >= 0. */
  @Prop({ type: Number, required: true, min: 0 })
  daysBefore: number;

  /** 0-100. */
  @Prop({ type: Number, required: true, min: 0, max: 100 })
  refundPercentage: number;
}
const CancellationTierSnapshotSchema = SchemaFactory.createForClass(
  CancellationTierSnapshot,
);

/** Flight baggage rules shown before payment (PAY-02, FLT-04, FLT-08). */
@Schema({ _id: false })
export class BaggagePolicySnapshot {
  /** Free bags per passenger for the booked cabin (FLT-04). */
  @Prop({ type: Number, required: true, min: 0 })
  freeBags: number;

  /** Max weight per bag in kg (FLT-04, also applies to extra bags, FLT-08). */
  @Prop({ type: Number, required: true, min: 0 })
  maxWeightKgPerBag: number;

  /** Price per extra bag in the platform currency, major units (FLT-08). */
  @Prop({ type: Number, required: true, min: 0 })
  extraBagPrice: number;

  /** Max extra bags per passenger (FLT-08). */
  @Prop({ type: Number, required: true, min: 0 })
  maxExtraBags: number;
}
const BaggagePolicySnapshotSchema = SchemaFactory.createForClass(
  BaggagePolicySnapshot,
);

/**
 * PAY-02: the user accepted the provider's policies for this booking, at
 * `acceptedAt`. POST /api/payments is refused until this record exists.
 * Collection: "policyacceptances".
 *
 * We store a SNAPSHOT of the policy as shown to the user, so that a later
 * change by the moderator cannot change what the user agreed to.
 */
@Schema({ timestamps: true, collection: 'policyacceptances' })
export class PolicyAcceptance {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: ['flight', 'hotel'], required: true })
  bookingType: BookingType;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  bookingId: Types.ObjectId;

  /** PAY-02: acceptance is stored with a timestamp. */
  @Prop({ type: Date, required: true })
  acceptedAt: Date;

  /** FLT-09 (flight) or HTL-10 (hotel) tiers at the time of acceptance. */
  @Prop({ type: [CancellationTierSnapshotSchema], default: [] })
  cancellationTiers: CancellationTierSnapshot[];

  /** Flights only (PAY-02: airline baggage policy). */
  @Prop({ type: BaggagePolicySnapshotSchema, default: null })
  baggagePolicy: BaggagePolicySnapshot | null;

  /** Hotels only (PAY-02, HTL-09), "HH:mm" local hotel time. */
  @Prop({ type: String, default: null })
  checkInTime: string | null;

  /** Hotels only (PAY-02, HTL-09), "HH:mm" local hotel time. */
  @Prop({ type: String, default: null })
  checkOutTime: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export type PolicyAcceptanceDocument = HydratedDocument<PolicyAcceptance>;
export const PolicyAcceptanceSchema =
  SchemaFactory.createForClass(PolicyAcceptance);

/** One acceptance per booking. Accepting again returns the existing record. */
PolicyAcceptanceSchema.index(
  { bookingType: 1, bookingId: 1 },
  { unique: true },
);

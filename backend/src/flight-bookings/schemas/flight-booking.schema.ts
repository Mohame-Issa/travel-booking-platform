import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types, type HydratedDocument } from 'mongoose';
import { BookingStatus, CabinClass } from '../flight-bookings.imports.js';

@Schema({ _id: false })
export class Passenger {
  @Prop({ required: true, trim: true }) fullName: string;
  @Prop({ required: true }) dateOfBirth: Date;
  @Prop({ required: true, trim: true, uppercase: true }) passportNumber: string;
  @Prop({ default: 0, min: 0 }) extraBags: number;
  @Prop({ default: 0, min: 0 }) baggageFee: number;
}
export const PassengerSchema = SchemaFactory.createForClass(Passenger);

@Schema({ collection: 'flightbookings', timestamps: true })
export class FlightBooking {
  @Prop({
    type: MongoSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;
  @Prop({
    type: MongoSchema.Types.ObjectId,
    ref: 'Flight',
    required: true,
    index: true,
  })
  flightId: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Airline', required: true })
  airlineId: Types.ObjectId;
  @Prop({ type: String, enum: Object.values(CabinClass), required: true })
  cabinClass: CabinClass;

  @Prop({ required: true, min: 1 }) seatCount: number;
  @Prop({ type: [PassengerSchema], default: [] }) passengers: Passenger[];

  // Snapshots, so lists need no joins and later changes don't alter the booking.
  @Prop({ required: true }) flightNumber: string;
  @Prop({ required: true }) departureAirport: string;
  @Prop({ required: true }) arrivalAirport: string;
  @Prop({ required: true }) departureTime: Date; // UTC, refreshed by flight.updated
  @Prop({ required: true }) arrivalTime: Date;

  @Prop({ required: true }) pricePerSeat: number;
  @Prop({ default: 0 }) baggageTotal: number;
  @Prop({ required: true }) totalAmount: number;
  @Prop({ required: true }) currency: string;

  // GEN-11 lifecycle
  @Prop({
    type: String,
    enum: Object.values(BookingStatus),
    default: BookingStatus.PENDING_PAYMENT,
    required: true,
  })
  status: BookingStatus;
  @Prop({ type: Date, default: null }) holdExpiresAt: Date | null;

  @Prop({ type: String, unique: true, sparse: true }) reference?: string; // FLT-23
  @Prop({ type: String }) paymentId?: string;
  @Prop({ type: Date }) confirmedAt?: Date;

  @Prop({ type: Date }) cancelledAt?: Date;
  @Prop({ type: String, enum: ['user', 'provider', 'system'] })
  cancelledBy?: 'user' | 'provider' | 'system';
  @Prop({ type: String }) refundId?: string;
  @Prop({ type: Number }) refundAmount?: number;
  @Prop({ type: String }) refundStatus?: string;
}
export type FlightBookingDocument = HydratedDocument<FlightBooking>;
export const FlightBookingSchema = SchemaFactory.createForClass(FlightBooking);
FlightBookingSchema.index({ userId: 1, status: 1, departureTime: 1 });
FlightBookingSchema.index({ flightId: 1, status: 1 });
FlightBookingSchema.index({ status: 1, holdExpiresAt: 1 });

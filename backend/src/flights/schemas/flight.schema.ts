import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types, type HydratedDocument } from 'mongoose';
import { FlightStatus } from '../catalogue.constants.js';

@Schema({ collection: 'flights', timestamps: true })
export class Flight {
  @Prop({
    type: MongoSchema.Types.ObjectId,
    ref: 'Airline',
    required: true,
    index: true,
  })
  airlineId: Types.ObjectId;
  @Prop({ required: true, uppercase: true, trim: true }) flightNumber: string;
  @Prop({ type: String, ref: 'Airport', required: true })
  departureAirport: string;
  @Prop({ type: String, ref: 'Airport', required: true })
  arrivalAirport: string;
  @Prop({ required: true, index: true }) departureTime: Date;
  @Prop({ required: true }) arrivalTime: Date;
  // FLT-03: uniqueness is per departure airport's local calendar date.
  @Prop({ required: true }) departureDate: string;
  @Prop({
    type: String,
    enum: Object.values(FlightStatus),
    default: FlightStatus.SCHEDULED,
    required: true,
    index: true,
  })
  status: FlightStatus;
  // FLT-05: lifetime count, including expired/cancelled bookings. Booking owner increments atomically.
  @Prop({ default: 0, min: 0, validate: Number.isInteger })
  bookingCount: number;
  /** Booking owner touches this in transactions to serialize with schedule/cancel changes. */
  @Prop({ default: 0, min: 0, validate: Number.isInteger })
  inventoryRevision: number;
}
export type FlightDocument = HydratedDocument<Flight>;
export const FlightSchema = SchemaFactory.createForClass(Flight);
FlightSchema.index(
  { airlineId: 1, flightNumber: 1, departureDate: 1 },
  { unique: true },
);
FlightSchema.index({
  departureAirport: 1,
  arrivalAirport: 1,
  departureDate: 1,
  status: 1,
});
FlightSchema.pre('validate', function () {
  // FLT-03: static invariants; FlightsService enforces reference airports and time-zone conversion.
  if (this.departureAirport === this.arrivalAirport)
    this.invalidate(
      'arrivalAirport',
      'Departure and arrival airports must differ',
    );
  if (this.arrivalTime <= this.departureTime)
    this.invalidate('arrivalTime', 'Arrival must be after departure in UTC');
});

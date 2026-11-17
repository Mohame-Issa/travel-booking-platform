import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types, type HydratedDocument } from 'mongoose';
import { CabinClass } from '../flight-bookings.imports.js';

/**
 * FLT-28 (bonus): one taken seat on one flight. Collection "seatassignments".
 * The unique index makes the database refuse a second passenger in the same
 * seat, even when two bookings are made at the same moment.
 */
@Schema({ collection: 'seatassignments', timestamps: true })
export class SeatAssignment {
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Flight', required: true })
  flightId: Types.ObjectId;
  @Prop({ type: String, enum: Object.values(CabinClass), required: true })
  cabinClass: CabinClass;
  @Prop({ required: true, uppercase: true, trim: true }) seatNumber: string;
  /**
   * The flight booking holding the seat, or a pending flight change (FLT-27)
   * until it is applied. Seats are released together with their owner.
   */
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, index: true })
  ownerId: Types.ObjectId;
  @Prop({ required: true, uppercase: true, trim: true })
  passportNumber: string;
}
export type SeatAssignmentDocument = HydratedDocument<SeatAssignment>;
export const SeatAssignmentSchema =
  SchemaFactory.createForClass(SeatAssignment);
SeatAssignmentSchema.index(
  { flightId: 1, cabinClass: 1, seatNumber: 1 },
  { unique: true },
);

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types, type HydratedDocument } from 'mongoose';
import { CabinClass } from '../catalogue.constants.js';

@Schema({ collection: 'cabininventories', timestamps: true })
export class CabinInventory {
  @Prop({
    type: MongoSchema.Types.ObjectId,
    ref: 'Flight',
    required: true,
    index: true,
  })
  flightId: Types.ObjectId;
  @Prop({ type: String, enum: Object.values(CabinClass), required: true })
  cabinClass: CabinClass;
  @Prop({ required: true, min: 1, validate: Number.isInteger })
  seatCount: number;
  // FLT-11, FLT-22: availability = seatCount - bookedSeats - heldSeats.
  @Prop({ default: 0, min: 0, validate: Number.isInteger }) bookedSeats: number;
  @Prop({ default: 0, min: 0, validate: Number.isInteger }) heldSeats: number;
  @Prop({ required: true, min: Number.MIN_VALUE, validate: Number.isFinite })
  price: number;
  @Prop({ required: true, min: 0, validate: Number.isInteger })
  freeBaggage: number;
  @Prop({ required: true, min: Number.MIN_VALUE, validate: Number.isFinite })
  maxBagWeightKg: number;
}
export type CabinInventoryDocument = HydratedDocument<CabinInventory>;
export const CabinInventorySchema =
  SchemaFactory.createForClass(CabinInventory);
CabinInventorySchema.index({ flightId: 1, cabinClass: 1 }, { unique: true });
CabinInventorySchema.pre('validate', function () {
  if (this.bookedSeats + this.heldSeats > this.seatCount)
    this.invalidate(
      'seatCount',
      'Seat count cannot be below booked plus held seats (FLT-05)',
    );
});

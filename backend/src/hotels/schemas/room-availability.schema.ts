import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types, type HydratedDocument } from 'mongoose';

export enum RoomAvailabilityKind {
  AVAILABLE = 'Available',
  BLOCKED = 'Blocked',
  HELD = 'Pending Payment',
  BOOKED = 'Confirmed',
}

// HTL-04/06/18: date-only UTC midnight ranges, [startDate, endDate).
// Proposed shared representation: Hashad must confirm booking-row integration.
// No hold creation, expiry, reservation workflow or overlap-locking logic is implemented here.
@Schema({ collection: 'roomavailabilities', timestamps: true })
export class RoomAvailability {
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Room', required: true })
  roomId: Types.ObjectId;
  @Prop({ required: true }) startDate: Date;
  @Prop({ required: true }) endDate: Date;
  @Prop({
    type: String,
    enum: Object.values(RoomAvailabilityKind),
    required: true,
  })
  kind: RoomAvailabilityKind;
  @Prop({
    type: MongoSchema.Types.ObjectId,
    ref: 'HotelBooking',
    default: null,
  })
  bookingId: Types.ObjectId | null;
  @Prop({ type: Date, default: null }) holdExpiresAt: Date | null;
}
export type RoomAvailabilityDocument = HydratedDocument<RoomAvailability>;
export const RoomAvailabilitySchema =
  SchemaFactory.createForClass(RoomAvailability);
RoomAvailabilitySchema.index({ roomId: 1, startDate: 1, endDate: 1, kind: 1 });
RoomAvailabilitySchema.pre('validate', function () {
  if (this.endDate <= this.startDate)
    this.invalidate('endDate', 'End date must be after start date (HTL-04)');
  for (const field of ['startDate', 'endDate'] as const) {
    const date = this[field];
    if (
      date instanceof Date &&
      (date.getUTCHours() ||
        date.getUTCMinutes() ||
        date.getUTCSeconds() ||
        date.getUTCMilliseconds())
    )
      this.invalidate(
        field,
        'Availability dates must be UTC midnight calendar dates',
      );
  }
});

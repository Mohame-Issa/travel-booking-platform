import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types, type HydratedDocument } from 'mongoose';
import { BookingStatus } from '../../common/interfaces/index.js';
import {
  CancellationTier,
  CancellationTierSchema,
} from '../../airlines/schemas/cancellation-tier.schema.js';

/** One booked room with the guests and the price agreed at booking time (HTL-05, HTL-16). */
@Schema({ _id: false })
export class BookedRoom {
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Room', required: true })
  roomId: Types.ObjectId;
  @Prop({ required: true }) roomNumber: string;
  @Prop({ required: true }) type: string;
  @Prop({ required: true }) pricePerNight: number;
  @Prop({ required: true, min: 0 }) adults: number;
  @Prop({ type: [Number], default: [] }) childrenAges: number[];
}
export const BookedRoomSchema = SchemaFactory.createForClass(BookedRoom);

/** Hotel policy that applied when the reservation was made (PAY-02/PAY-03 read it). */
@Schema({ _id: false })
export class PolicySnapshot {
  @Prop({ type: String, default: null }) checkInTime: string | null;
  @Prop({ type: String, default: null }) checkOutTime: string | null;
  @Prop({ type: [CancellationTierSchema], default: [] })
  cancellationTiers: CancellationTier[];
}
export const PolicySnapshotSchema =
  SchemaFactory.createForClass(PolicySnapshot);

/** GEN-11 hotel reservation. Inventory lives in Yassin's RoomAvailability rows (bookingId). */
@Schema({ collection: 'hotelbookings', timestamps: true })
export class HotelBooking {
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Hotel', required: true })
  hotelId: Types.ObjectId;
  @Prop({ type: [BookedRoomSchema], required: true }) rooms: BookedRoom[];
  /** UTC midnight; check-out is exclusive. */
  @Prop({ required: true }) checkInDate: Date;
  @Prop({ required: true }) checkOutDate: Date;
  @Prop({ required: true }) nights: number;
  /** Major units in the hotel's currency. */
  @Prop({ required: true }) totalAmount: number;
  @Prop({ required: true }) currency: string;
  @Prop({
    type: String,
    enum: Object.values(BookingStatus),
    default: BookingStatus.PENDING_PAYMENT,
    required: true,
  })
  status: BookingStatus;
  /** HTL-18 hold end; null once confirmed. */
  @Prop({ type: Date, default: null }) holdExpiresAt: Date | null;
  /** HTL-17: issued at confirmation. */
  @Prop({ type: String, default: undefined }) reference?: string;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Payment', default: null })
  paymentId: Types.ObjectId | null;
  @Prop({ type: Date, default: null }) confirmedAt: Date | null;
  @Prop({ type: Date, default: null }) cancelledAt: Date | null;
  @Prop({ type: PolicySnapshotSchema, required: true }) policy: PolicySnapshot;
  createdAt: Date;
}
export type HotelBookingDocument = HydratedDocument<HotelBooking>;
export const HotelBookingSchema = SchemaFactory.createForClass(HotelBooking);
HotelBookingSchema.index({ reference: 1 }, { unique: true, sparse: true });
HotelBookingSchema.index({ userId: 1, checkInDate: -1 });
HotelBookingSchema.index({ hotelId: 1, checkInDate: -1 });
HotelBookingSchema.index({ status: 1, holdExpiresAt: 1 });
HotelBookingSchema.index({ 'rooms.roomId': 1 });

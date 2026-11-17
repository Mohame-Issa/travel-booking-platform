import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Schema as MongooseSchema,
  Types,
  type HydratedDocument,
} from 'mongoose';
import type { BookingType } from '../../common/interfaces/index.js';

/**
 * ITN-27 (bonus): one of the owner's flight bookings or hotel reservations
 * linked to an itinerary day. Collection: "itinerarybookings".
 * Only the link is stored; the amount and status are read from the booking
 * each time, so a cancelled booking stops counting in the budget by itself.
 */
@Schema({ timestamps: true, collection: 'itinerarybookings' })
export class ItineraryBooking {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Itinerary',
    required: true,
    index: true,
  })
  itineraryId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'ItineraryDay',
    required: true,
    index: true,
  })
  dayId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: ['flight', 'hotel'], required: true })
  bookingType: BookingType;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  bookingId: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export type ItineraryBookingDocument = HydratedDocument<ItineraryBooking>;
export const ItineraryBookingSchema =
  SchemaFactory.createForClass(ItineraryBooking);
/** A booking is linked to an itinerary at most once. */
ItineraryBookingSchema.index(
  { itineraryId: 1, bookingType: 1, bookingId: 1 },
  { unique: true },
);

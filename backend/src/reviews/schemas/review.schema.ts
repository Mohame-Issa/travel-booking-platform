import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Schema as MongooseSchema,
  Types,
  type HydratedDocument,
} from 'mongoose';

/** HTL-26 (bonus): the hotel moderator's public reply to a review. */
@Schema({ _id: false })
export class ReviewReply {
  @Prop({ type: String, required: true, trim: true, maxlength: 1000 })
  body: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  moderatorId: Types.ObjectId;

  @Prop({ type: Date, required: true })
  repliedAt: Date;
}
const ReviewReplySchema = SchemaFactory.createForClass(ReviewReply);

/**
 * A rating (1-5) with an optional review of a completed hotel stay (HTL-23).
 * Collection: "reviews". One per reservation, however many rooms it had.
 */
@Schema({ timestamps: true, collection: 'reviews' })
export class Review {
  /** Author = owner of the reservation. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hotel', required: true })
  hotelId: Types.ObjectId;

  /** HTL-23: one review per Completed reservation (unique index below). */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'HotelBooking',
    required: true,
  })
  bookingId: Types.ObjectId;

  /** HTL-23: 1-5, whole stars. */
  @Prop({
    type: Number,
    required: true,
    min: 1,
    max: 5,
    validate: Number.isInteger,
  })
  rating: number;

  /** HTL-23: optional, max 1000 characters. */
  @Prop({ type: String, default: '', maxlength: 1000 })
  comment: string;

  /**
   * GEN-10: set when an admin hides the review. Hidden reviews are visible
   * only to their author and admins and do not count in the hotel's rating.
   */
  @Prop({ type: Date, default: null })
  hiddenAt: Date | null;

  /** HTL-26 (bonus): one reply per review; replying again replaces it. */
  @Prop({ type: ReviewReplySchema, default: null })
  reply: ReviewReply | null;

  createdAt: Date;
  updatedAt: Date;
}

export type ReviewDocument = HydratedDocument<Review>;
export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.index({ bookingId: 1 }, { unique: true });
/** HTL-24: a hotel's reviews, newest first. */
ReviewSchema.index({ hotelId: 1, createdAt: -1 });

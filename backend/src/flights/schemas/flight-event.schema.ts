import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';

/** Transactional outbox owned by flight catalogue; contains no passenger/user credentials. */
@Schema({ timestamps: true, collection: 'flightevents' })
export class FlightEvent {
  @Prop({ required: true, enum: ['flight.cancelled', 'flight.updated'] })
  topic: string;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Flight', required: true })
  flightId: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.Mixed, required: true }) payload: Record<
    string,
    unknown
  >;
  @Prop({ type: Date, default: null }) deliveredAt: Date | null;
  @Prop({ type: Date, default: null }) leaseUntil: Date | null;
  @Prop({ default: 0 }) attempts: number;
}
export const FlightEventSchema = SchemaFactory.createForClass(FlightEvent);
FlightEventSchema.index({ deliveredAt: 1, leaseUntil: 1, createdAt: 1 });

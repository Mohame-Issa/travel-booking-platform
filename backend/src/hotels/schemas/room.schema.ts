import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types, type HydratedDocument } from 'mongoose';
import { ProviderStatus } from '../../flights/catalogue.constants.js';

@Schema({ collection: 'rooms', timestamps: true })
export class Room {
  @Prop({
    type: MongoSchema.Types.ObjectId,
    ref: 'Hotel',
    required: true,
    index: true,
  })
  hotelId: Types.ObjectId;
  @Prop({ required: true, trim: true }) roomNumber: string;
  @Prop({ required: true }) type: string;
  @Prop({ required: true, min: 1, validate: Number.isInteger }) beds: number;
  @Prop({ required: true, min: 1, validate: Number.isInteger })
  maxOccupancy: number;
  @Prop({ required: true, min: Number.MIN_VALUE, validate: Number.isFinite })
  pricePerNight: number;
  @Prop({
    type: String,
    enum: Object.values(ProviderStatus),
    default: ProviderStatus.ACTIVE,
    required: true,
    index: true,
  })
  status: ProviderStatus;
}
export type RoomDocument = HydratedDocument<Room>;
export const RoomSchema = SchemaFactory.createForClass(Room);
RoomSchema.index({ hotelId: 1, roomNumber: 1 }, { unique: true });

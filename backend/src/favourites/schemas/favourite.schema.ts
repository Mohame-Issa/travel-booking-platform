import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Schema as MongooseSchema,
  Types,
  type HydratedDocument,
} from 'mongoose';

export enum FavouriteType {
  HOTEL = 'hotel',
  ITINERARY = 'itinerary',
}

/**
 * BON-02 (bonus): one saved hotel or public itinerary of one user.
 * Collection "favourites". The unique index makes saving the same item twice
 * a no-op, even with parallel clicks.
 */
@Schema({ collection: 'favourites', timestamps: true })
export class Favourite {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;
  @Prop({ type: String, enum: Object.values(FavouriteType), required: true })
  targetType: FavouriteType;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  targetId: Types.ObjectId;
  createdAt: Date;
}
export type FavouriteDocument = HydratedDocument<Favourite>;
export const FavouriteSchema = SchemaFactory.createForClass(Favourite);
FavouriteSchema.index(
  { userId: 1, targetType: 1, targetId: 1 },
  { unique: true },
);
FavouriteSchema.index({ userId: 1, createdAt: -1 });

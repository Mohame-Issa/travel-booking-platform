import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Schema as MongooseSchema,
  Types,
  type HydratedDocument,
} from 'mongoose';

/** One user's like of one post (BLG-06). Collection: "likes". */
@Schema({ timestamps: true, collection: 'likes' })
export class Like {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Post', required: true })
  postId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export type LikeDocument = HydratedDocument<Like>;
export const LikeSchema = SchemaFactory.createForClass(Like);
/** BLG-06: a user likes a post at most once, even with two clicks at the same time. */
LikeSchema.index({ postId: 1, userId: 1 }, { unique: true });

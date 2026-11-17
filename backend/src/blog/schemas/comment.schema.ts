import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Schema as MongooseSchema,
  Types,
  type HydratedDocument,
} from 'mongoose';

/** A comment on a published post (BLG-05). Collection: "comments". */
@Schema({ timestamps: true, collection: 'comments' })
export class Comment {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Post', required: true })
  postId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  authorId: Types.ObjectId;

  /** BLG-05: non-empty, max 500 characters. */
  @Prop({ type: String, required: true, trim: true, maxlength: 500 })
  body: string;

  /** GEN-10: hidden by an admin. */
  @Prop({ type: Date, default: null })
  hiddenAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type CommentDocument = HydratedDocument<Comment>;
export const CommentSchema = SchemaFactory.createForClass(Comment);
/** BLG-05: chronological order per post. */
CommentSchema.index({ postId: 1, createdAt: 1 });

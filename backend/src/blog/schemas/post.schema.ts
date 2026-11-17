import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Schema as MongooseSchema,
  Types,
  type HydratedDocument,
} from 'mongoose';

export enum PostStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}

/** An image attached through the shared upload service (GEN-08, BLG-10). */
@Schema({ _id: false })
export class PostImage {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Upload', required: true })
  imageId: Types.ObjectId;

  @Prop({ type: String, required: true })
  url: string;
}
const PostImageSchema = SchemaFactory.createForClass(PostImage);

/** A blog post (BLG-01). Collection: "posts". */
@Schema({ timestamps: true, collection: 'posts' })
export class Post {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  authorId: Types.ObjectId;

  /** BLG-01: required. */
  @Prop({ type: String, required: true, trim: true })
  title: string;

  /** BLG-01: required. */
  @Prop({ type: String, required: true })
  body: string;

  /** BLG-08: up to 5 tags, max 30 characters each, stored lower case. */
  @Prop({
    type: [String],
    default: [],
    validate: {
      validator: (t: string[]) => t.length <= 5,
      message: 'At most 5 tags (BLG-08)',
    },
  })
  tags: string[];

  /** BLG-01: Draft or Published. Only published posts are public. */
  @Prop({
    type: String,
    enum: Object.values(PostStatus),
    default: PostStatus.DRAFT,
    index: true,
  })
  status: PostStatus;

  /** Date shown on the post (BLG-02); set the first time it is published. */
  @Prop({ type: Date, default: null })
  publishedAt: Date | null;

  /** BLG-10 / GEN-08: at most 5 (enforced by the upload service). */
  @Prop({ type: [PostImageSchema], default: [] })
  images: PostImage[];

  /** BLG-06: kept equal to the number of Like documents. */
  @Prop({ type: Number, default: 0, min: 0 })
  likeCount: number;

  /** BLG-03: visible comments. */
  @Prop({ type: Number, default: 0, min: 0 })
  commentCount: number;

  /** BLG-09: interaction score = likes + comments, the search order. */
  @Prop({ type: Number, default: 0, min: 0 })
  score: number;

  /** GEN-10: set when an admin hides the post. Visible only to its author and admins. */
  @Prop({ type: Date, default: null })
  hiddenAt: Date | null;

  /**
   * BLG-13 (bonus): an itinerary of the author attached to the post. Readers
   * only see it while it is public and not hidden.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Itinerary',
    default: null,
  })
  itineraryId: Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

export type PostDocument = HydratedDocument<Post>;
export const PostSchema = SchemaFactory.createForClass(Post);
PostSchema.index({ status: 1, publishedAt: -1 });
PostSchema.index({ status: 1, score: -1, publishedAt: -1 });
PostSchema.index({ tags: 1 });

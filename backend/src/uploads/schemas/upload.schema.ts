import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types, type HydratedDocument } from 'mongoose';
import { IMAGE_LIMITS, type UploadOwnerType } from '../image-type.js';

/**
 * GEN-08: one stored image. The file lives on disk under UPLOAD_DIR/storedName;
 * this row records who uploaded it and which entity (if any) it is attached to.
 */
@Schema({ collection: 'uploads', timestamps: true })
export class Upload {
  @Prop({
    type: MongoSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  uploaderId: Types.ObjectId;
  @Prop({ required: true, unique: true }) storedName: string;
  @Prop({ required: true }) mimeType: string;
  @Prop({ required: true }) size: number;
  @Prop({ type: String, enum: Object.keys(IMAGE_LIMITS), default: null })
  ownerType: UploadOwnerType | null;
  @Prop({ type: MongoSchema.Types.ObjectId, default: null })
  ownerId: Types.ObjectId | null;
  /** 0..limit-1; the unique index below makes the per-owner count race-free. */
  @Prop({ type: Number, default: null }) slot: number | null;
}
export type UploadDocument = HydratedDocument<Upload>;
export const UploadSchema = SchemaFactory.createForClass(Upload);
UploadSchema.index(
  { ownerType: 1, ownerId: 1, slot: 1 },
  { unique: true, partialFilterExpression: { ownerId: { $type: 'objectId' } } },
);

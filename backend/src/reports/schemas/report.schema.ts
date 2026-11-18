import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Schema as MongooseSchema,
  Types,
  type HydratedDocument,
} from 'mongoose';

/**
 * Content that can be reported and moderated (GEN-09, GEN-10). Posts and
 * comments belong to the blog, which is bonus scope for this team.
 */
export enum ReportTargetType {
  POST = 'post',
  COMMENT = 'comment',
  REVIEW = 'review',
  ITINERARY = 'itinerary',
}

export enum ReportStatus {
  OPEN = 'open',
  DISMISSED = 'dismissed',
  CONTENT_HIDDEN = 'content_hidden',
  CONTENT_DELETED = 'content_deleted',
}

/** A user's report of a post, comment, review or itinerary (GEN-09). Collection: "reports". */
@Schema({ timestamps: true, collection: 'reports' })
export class Report {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  reporterId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(ReportTargetType), required: true })
  targetType: ReportTargetType;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  targetId: Types.ObjectId;

  /** GEN-09: "with a reason". */
  @Prop({ type: String, required: true, trim: true })
  reason: string;

  @Prop({
    type: String,
    enum: Object.values(ReportStatus),
    default: ReportStatus.OPEN,
    index: true,
  })
  status: ReportStatus;

  /** Admin who resolved it (GEN-10). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  resolvedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  resolvedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type ReportDocument = HydratedDocument<Report>;
export const ReportSchema = SchemaFactory.createForClass(Report);
/** GEN-09: a user reports an item at most once. */
ReportSchema.index(
  { reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true },
);
ReportSchema.index({ targetType: 1, targetId: 1, status: 1 });

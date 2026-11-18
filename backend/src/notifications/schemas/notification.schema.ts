import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types, type HydratedDocument } from 'mongoose';
import type { NotificationType } from '../../common/interfaces/index.js';

/** GEN-01: one in-app notification for one user. */
@Schema({ collection: 'notifications', timestamps: true })
export class Notification {
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;
  @Prop({ type: String, required: true }) type: NotificationType;
  @Prop({ required: true }) title: string;
  @Prop({ required: true }) message: string;
  @Prop({ type: MongoSchema.Types.Mixed, default: null })
  data: Record<string, unknown> | null;
  @Prop({ type: Date, default: null }) readAt: Date | null;
  createdAt: Date;
}
export type NotificationDocument = HydratedDocument<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, readAt: 1 });

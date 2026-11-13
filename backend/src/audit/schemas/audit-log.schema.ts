import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types, type HydratedDocument } from 'mongoose';

/** GEN-07: one administrative action. Append-only. */
@Schema({
  collection: 'auditlogs',
  timestamps: { createdAt: true, updatedAt: false },
})
export class AuditLog {
  @Prop({
    type: MongoSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  actorId: Types.ObjectId;
  @Prop({ required: true, index: true }) action: string;
  @Prop({ required: true, index: true }) targetType: string;
  @Prop({ type: String, default: null }) targetId: string | null;
  @Prop({ type: MongoSchema.Types.Mixed, default: null })
  details: Record<string, unknown> | null;
  createdAt: Date;
}
export type AuditLogDocument = HydratedDocument<AuditLog>;
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ createdAt: -1 });

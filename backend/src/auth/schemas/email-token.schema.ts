import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Schema as MongooseSchema,
  Types,
  type HydratedDocument,
} from 'mongoose';

export enum EmailTokenPurpose {
  VERIFY_EMAIL = 'verify_email', // ACC-02
  RESET_PASSWORD = 'reset_password', // ACC-07
}

/**
 * One-time link sent by email (ACC-02, ACC-07). Collection "emailtokens".
 * Only a SHA-256 hash of the token is stored: someone who can read the
 * database still cannot use a link. Expired rows are removed by MongoDB
 * itself (TTL index on expiresAt).
 */
@Schema({ collection: 'emailtokens', timestamps: true })
export class EmailToken {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(EmailTokenPurpose),
    required: true,
  })
  purpose: EmailTokenPurpose;

  @Prop({ required: true, unique: true })
  tokenHash: string;

  @Prop({ required: true })
  expiresAt: Date;

  /** Set when the link is used: single use. */
  @Prop({ type: Date, default: null })
  usedAt: Date | null;
}
export type EmailTokenDocument = HydratedDocument<EmailToken>;
export const EmailTokenSchema = SchemaFactory.createForClass(EmailToken);
EmailTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

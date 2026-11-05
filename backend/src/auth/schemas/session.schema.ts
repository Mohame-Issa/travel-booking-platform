import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * Server-side login session (ACC-06, ACC-19). Collection: "sessions".
 *
 * One document per login. It stores only a SHA-256 hash of the refresh
 * token. Logout deletes the document, which revokes the refresh token.
 * `expiresAt` slides forward on activity (30 min idle timeout); MongoDB's
 * TTL index deletes expired sessions automatically.
 */
@Schema({ timestamps: true, collection: 'sessions' })
export class Session {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  refreshTokenHash: string;

  @Prop({ type: Date, required: true })
  lastActivityAt: Date;

  /** lastActivityAt + 30 minutes. TTL index removes the document after this time. */
  @Prop({ type: Date, required: true, expires: 0 })
  expiresAt: Date;

  @Prop({ type: String, default: null })
  userAgent: string | null;

  @Prop({ type: String, default: null })
  ip: string | null;
}

export type SessionDocument = HydratedDocument<Session>;
export const SessionSchema = SchemaFactory.createForClass(Session);

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isValidObjectId, Model, Types } from 'mongoose';
import {
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from './auth.constants.js';
import { Session, SessionDocument } from './schemas/session.schema.js';

export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

/**
 * Refresh token format sent to the browser: "<sessionId>.<random secret>".
 * Only sha256(secret) is stored, so a database leak does not leak usable tokens.
 */
@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(Session.name) private readonly sessionModel: Model<Session>,
  ) {}

  async create(
    userId: string,
    meta: SessionMeta,
  ): Promise<{ sessionId: string; refreshToken: string }> {
    const secret = newSecret();
    const now = new Date();
    const session = await this.sessionModel.create({
      userId: new Types.ObjectId(userId),
      refreshTokenHash: sha256(secret),
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS),
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      ip: meta.ip ?? null,
    });
    const sessionId = String(session._id);
    return { sessionId, refreshToken: `${sessionId}.${secret}` };
  }

  /** A session that exists and has not been idle for 30 minutes. */
  async findActive(sessionId: string): Promise<SessionDocument | null> {
    if (!isValidObjectId(sessionId)) return null;
    return this.sessionModel
      .findOne({ _id: sessionId, expiresAt: { $gt: new Date() } })
      .exec();
  }

  /** Slides the 30-minute idle window forward (at most one write per minute). */
  async touch(session: SessionDocument): Promise<void> {
    const now = Date.now();
    if (now - session.lastActivityAt.getTime() < SESSION_TOUCH_INTERVAL_MS)
      return;
    await this.sessionModel
      .updateOne(
        { _id: session._id },
        {
          $set: {
            lastActivityAt: new Date(now),
            expiresAt: new Date(now + SESSION_IDLE_TIMEOUT_MS),
          },
        },
      )
      .exec();
  }

  /**
   * Validates a refresh token and replaces it with a new one (rotation).
   * If the secret does not match, the session is deleted: an old (possibly
   * stolen) refresh token was reused.
   */
  async rotate(
    refreshToken: string,
  ): Promise<{ session: SessionDocument; refreshToken: string } | null> {
    const [sessionId, secret] = refreshToken.split('.');
    if (!sessionId || !secret) return null;

    const session = await this.findActive(sessionId);
    if (!session) return null;

    if (!safeEqualHex(session.refreshTokenHash, sha256(secret))) {
      await this.revoke(sessionId);
      return null;
    }

    const newSecretValue = newSecret();
    const now = Date.now();
    // Conditional update: if two refreshes race, only one wins.
    const updated = await this.sessionModel
      .findOneAndUpdate(
        { _id: session._id, refreshTokenHash: session.refreshTokenHash },
        {
          $set: {
            refreshTokenHash: sha256(newSecretValue),
            lastActivityAt: new Date(now),
            expiresAt: new Date(now + SESSION_IDLE_TIMEOUT_MS),
          },
        },
        { returnDocument: 'after' },
      )
      .exec();
    if (!updated) return null;
    return { session: updated, refreshToken: `${sessionId}.${newSecretValue}` };
  }

  async revoke(sessionId: string): Promise<void> {
    if (!isValidObjectId(sessionId)) return;
    await this.sessionModel.deleteOne({ _id: sessionId }).exec();
  }

  /** Logs a user out everywhere (e.g. after a password reset), optionally keeping one session. */
  async revokeAllForUser(
    userId: string,
    exceptSessionId?: string,
  ): Promise<void> {
    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (exceptSessionId)
      filter._id = { $ne: new Types.ObjectId(exceptSessionId) };
    await this.sessionModel.deleteMany(filter).exec();
  }
}

function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

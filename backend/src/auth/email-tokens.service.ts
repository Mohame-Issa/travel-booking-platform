import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { EmailToken, EmailTokenPurpose } from './schemas/email-token.schema.js';

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** Creates and consumes the one-time email links of ACC-02 and ACC-07. */
@Injectable()
export class EmailTokensService {
  constructor(
    @InjectModel(EmailToken.name) private readonly tokens: Model<EmailToken>,
  ) {}

  /**
   * New random token (256 bits). Every older unused token of the same user
   * and purpose is deleted first, so only the newest link works (ACC-07).
   * Returns the plain token, which only ever goes into the email.
   */
  async issue(
    userId: Types.ObjectId | string,
    purpose: EmailTokenPurpose,
    ttlMs: number,
  ): Promise<string> {
    const uid = new Types.ObjectId(String(userId));
    await this.tokens.deleteMany({ userId: uid, purpose, usedAt: null }).exec();
    const token = randomBytes(32).toString('base64url');
    await this.tokens.create({
      userId: uid,
      purpose,
      tokenHash: hash(token),
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return token;
  }

  /**
   * Uses a token once. Atomic: two requests with the same link cannot both
   * succeed. Unknown, used and expired links all get the same answer.
   */
  async consume(
    token: string,
    purpose: EmailTokenPurpose,
  ): Promise<Types.ObjectId> {
    const row = await this.tokens
      .findOneAndUpdate(
        {
          tokenHash: hash(token),
          purpose,
          usedAt: null,
          expiresAt: { $gt: new Date() },
        },
        { $set: { usedAt: new Date() } },
      )
      .lean()
      .exec();
    if (!row)
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.INVALID_EMAIL_TOKEN,
        'This link is invalid, has expired or was already used. Please request a new one.',
      );
    return row.userId;
  }

  /** Removes a user's remaining unused links of one purpose. */
  async revokeAll(userId: Types.ObjectId, purpose: EmailTokenPurpose) {
    await this.tokens.deleteMany({ userId, purpose, usedAt: null }).exec();
  }
}

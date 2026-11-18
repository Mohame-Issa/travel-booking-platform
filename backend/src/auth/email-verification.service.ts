import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { MailService } from '../mail/mail.service.js';
import { User, type UserDocument } from '../users/schemas/user.schema.js';
import { EmailTokensService } from './email-tokens.service.js';
import { EmailTokenPurpose } from './schemas/email-token.schema.js';

/**
 * ACC-02 (bonus) does not say how long the link works; we chose 24 hours.
 * A new link can always be requested.
 */
export const VERIFY_EMAIL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Base of the links in the emails: this backend's public address, because
 * the links open small pages served by the API itself (account-pages.ts).
 * BACKEND_URL in .env, else http://localhost:<PORT>.
 */
export function backendUrl(config: ConfigService): string {
  const url =
    config.get<string>('BACKEND_URL') ??
    `http://localhost:${config.get<string>('PORT') ?? 3000}`;
  return url.replace(/\/$/, '');
}

/**
 * ACC-02 (bonus): after registration a verification link is emailed, and
 * booking is blocked until the email is verified (EmailVerifiedGuard).
 * Added by Youssef Khafagy next to Mohamed Amr's auth module.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly tokens: EmailTokensService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Called right after registration. A mail problem must not undo the
   * registration, so it is logged and the user can ask for a new link.
   */
  async sendFor(user: UserDocument): Promise<void> {
    try {
      const token = await this.tokens.issue(
        user._id,
        EmailTokenPurpose.VERIFY_EMAIL,
        VERIFY_EMAIL_TTL_MS,
      );
      const link = `${backendUrl(this.config)}/api/auth/verify-email?token=${token}`;
      await this.mail.send({
        to: user.email,
        subject: 'Verify your email address',
        text:
          `Hello ${user.name},\n\n` +
          `Please verify your email address to start booking flights and hotels:\n${link}\n\n` +
          'The link works once and expires in 24 hours. If you did not create an account, ignore this email.',
      });
    } catch (e) {
      this.logger.error(
        `Verification email for user ${String(user._id)} failed: ${(e as Error).message}`,
      );
    }
  }

  /** POST /api/auth/verify-email */
  async verify(token: string): Promise<void> {
    const userId = await this.tokens.consume(
      token,
      EmailTokenPurpose.VERIFY_EMAIL,
    );
    await this.users
      .updateOne({ _id: userId }, { $set: { emailVerified: true } })
      .exec();
  }

  /** POST /api/auth/resend-verification (logged in) */
  async resend(userId: string): Promise<void> {
    const user = await this.users.findById(userId).exec();
    if (!user) return;
    if (user.emailVerified !== false)
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.EMAIL_ALREADY_VERIFIED,
        'Your email address is already verified',
      );
    await this.sendFor(user);
  }
}

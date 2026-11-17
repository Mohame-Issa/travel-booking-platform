import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserStatus } from '../common/constants/roles.js';
import { MailService } from '../mail/mail.service.js';
import { User } from '../users/schemas/user.schema.js';
import { AuthService } from './auth.service.js';
import { EmailTokensService } from './email-tokens.service.js';
import { frontendUrl } from './email-verification.service.js';
import { EmailTokenPurpose } from './schemas/email-token.schema.js';

/** ACC-07: "the link expires after 30 minutes". */
export const RESET_LINK_TTL_MS = 30 * 60 * 1000;

/** ACC-07: the same answer whether or not the email exists. */
export const FORGOT_PASSWORD_MESSAGE =
  'If an account exists for this email address, a password reset link has been sent to it.';

/**
 * ACC-07 (bonus): forgot password by email. Added by Youssef Khafagy next to
 * Mohamed Amr's auth module, reusing his password hashing and session revoke.
 *  - link expires after 30 minutes and works once (EmailTokensService.consume)
 *  - a newer request invalidates older links (EmailTokensService.issue)
 *  - the response never reveals whether the email exists
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly tokens: EmailTokensService,
    private readonly mail: MailService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * POST /api/auth/forgot-password. The work runs in the background, so the
   * answer comes back equally fast whether or not the account exists (no
   * timing hint either).
   */
  requestReset(email: string): void {
    void this.sendLink(email).catch((e: Error) =>
      this.logger.error(`Password reset email failed: ${e.message}`),
    );
  }

  /** POST /api/auth/reset-password */
  async reset(token: string, newPassword: string): Promise<void> {
    const userId = await this.tokens.consume(
      token,
      EmailTokenPurpose.RESET_PASSWORD,
    );
    await this.users
      .updateOne(
        { _id: userId },
        {
          $set: {
            passwordHash: await this.auth.hashPassword(newPassword),
            mustChangePassword: false,
            passwordChangedAt: new Date(),
            // A forgotten password should not leave the account locked (ACC-05).
            failedLoginAttempts: 0,
            lockUntil: null,
            // Using the link proves the user owns the mailbox (ACC-02).
            emailVerified: true,
          },
        },
      )
      .exec();
    // Any other reset link stops working, and every session is logged out.
    await this.tokens.revokeAll(userId, EmailTokenPurpose.RESET_PASSWORD);
    await this.auth.revokeAllSessionsForUser(String(userId));
  }

  private async sendLink(email: string): Promise<void> {
    const user = await this.users
      .findOne({ email: email.trim().toLowerCase() })
      .exec();
    // Suspended and deactivated accounts cannot log in anyway (ACC-04, ACC-12).
    if (!user || user.status !== UserStatus.ACTIVE) return;
    const token = await this.tokens.issue(
      user._id,
      EmailTokenPurpose.RESET_PASSWORD,
      RESET_LINK_TTL_MS,
    );
    await this.mail.send({
      to: user.email,
      subject: 'Reset your password',
      text:
        `Hello ${user.name},\n\n` +
        `Use this link to choose a new password:\n${frontendUrl(this.config)}/reset-password?token=${token}\n\n` +
        'The link works once and expires in 30 minutes. Requesting another link cancels this one. ' +
        'If you did not ask for this, you can ignore this email; your password stays the same.',
    });
  }
}

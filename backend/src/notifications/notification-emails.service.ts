import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserStatus } from '../common/constants/roles.js';
import { MailService } from '../mail/mail.service.js';
import { User } from '../users/schemas/user.schema.js';

/**
 * GEN-01-B (bonus): "also send the GEN-01 notifications (plus moderator
 * invitations) by email via SMTP, using a test inbox in development".
 * Added by Youssef Khafagy next to Mohamed Hashad's notifications. Uses the
 * same MailService as ACC-02/ACC-07 (SMTP from .env, else an Ethereal test
 * inbox). Email is a copy: the in-app notification is the source of truth,
 * so a mail problem is only logged and never breaks a booking or a refund.
 */
@Injectable()
export class NotificationEmailsService {
  private readonly logger = new Logger(NotificationEmailsService.name);

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    // Optional so test setups without MailModule still start.
    @Optional() private readonly mail?: MailService,
  ) {}

  /** Emails one notification to each user. Never throws. */
  async emailUsers(
    userIds: string[],
    note: { title: string; message: string },
  ): Promise<void> {
    if (!this.mail || !userIds.length) return;
    try {
      const rows = await this.users
        .find(
          {
            _id: { $in: userIds.map((id) => new Types.ObjectId(id)) },
            // ACC-12: deactivated accounts get no more emails.
            status: { $ne: UserStatus.DEACTIVATED },
          },
          { email: 1, name: 1 },
        )
        .lean()
        .exec();
      for (const u of rows) {
        await this.mail.send({
          to: u.email,
          subject: note.title,
          text:
            `Hello ${u.name},\n\n${note.message}\n\n` +
            'You can also see this under Notifications in your account.\n\nTravel Platform',
        });
      }
    } catch (e) {
      this.logger.error(`Notification email failed: ${(e as Error).message}`);
    }
  }

  /**
   * ACC-13 + GEN-01-B: tells a new moderator their account exists. The
   * temporary password is NOT emailed (the admin gives it to them); it must
   * be changed at the first login anyway.
   */
  async inviteModerator(
    moderator: { email: string; name: string },
    providerKind: 'airline' | 'hotel',
    providerName: string,
  ): Promise<void> {
    if (!this.mail) return;
    try {
      await this.mail.send({
        to: moderator.email,
        subject: `You are invited as the ${providerKind} moderator of ${providerName}`,
        text:
          `Hello ${moderator.name},\n\n` +
          `An administrator created a ${providerKind} moderator account for you to manage ${providerName} ` +
          'on the Travel Platform.\n\n' +
          `Log in with this email address (${moderator.email}) and the temporary password the administrator gives you. ` +
          'You will be asked to choose your own password at the first login.\n\nTravel Platform',
      });
    } catch (e) {
      this.logger.error(
        `Moderator invitation email failed: ${(e as Error).message}`,
      );
    }
  }
}

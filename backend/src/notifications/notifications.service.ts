import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import type {
  NotificationService,
  NotifyInput,
} from '../common/interfaces/index.js';
import { paginate } from '../common/utils/paginate.js';
import { NotificationEmailsService } from './notification-emails.service.js';
import { Notification } from './schemas/notification.schema.js';

/** GEN-01. Bound to NOTIFICATION_SERVICE so any module can notify a user. */
@Injectable()
export class NotificationsService implements NotificationService {
  constructor(
    @InjectModel(Notification.name) private readonly notes: Model<Notification>,
    private readonly emails: NotificationEmailsService, // GEN-01-B (bonus)
  ) {}

  async notify(input: NotifyInput): Promise<void> {
    await this.notes.create(input);
    // GEN-01-B: email copy in the background, so SMTP never slows a booking.
    void this.emails.emailUsers([input.userId], input);
  }

  async notifyMany(
    userIds: string[],
    input: Omit<NotifyInput, 'userId'>,
  ): Promise<void> {
    const unique = [...new Set(userIds)];
    if (!unique.length) return;
    await this.notes.insertMany(unique.map((userId) => ({ ...input, userId })));
    void this.emails.emailUsers(unique, input); // GEN-01-B (bonus)
  }

  listMine(userId: string, page: number, unreadOnly = false) {
    const filter = unreadOnly ? { userId, readAt: null } : { userId };
    return paginate(this.notes, filter, { page, sort: { createdAt: -1 } });
  }

  /** Someone else's notification answers 404, so ids cannot be probed. */
  async markRead(userId: string, id: string) {
    const note = await this.notes.findOne({ _id: id, userId }).exec();
    if (!note)
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Notification not found',
      );
    if (!note.readAt) {
      note.readAt = new Date();
      await note.save();
    }
    return note;
  }

  async markAllRead(userId: string) {
    const res = await this.notes
      .updateMany({ userId, readAt: null }, { $set: { readAt: new Date() } })
      .exec();
    return { updated: res.modifiedCount };
  }
}

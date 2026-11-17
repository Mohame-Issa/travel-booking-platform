import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NOTIFICATION_SERVICE } from '../common/interfaces/index.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationEmailsService } from './notification-emails.service.js';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema.js';

/** GEN-01. Global so any module can inject NOTIFICATION_SERVICE. */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationEmailsService, // GEN-01-B (bonus)
    { provide: NOTIFICATION_SERVICE, useExisting: NotificationsService },
  ],
  exports: [NOTIFICATION_SERVICE, NotificationEmailsService],
})
export class NotificationsModule {}

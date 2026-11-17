import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service.js';

/** Global so any module can send account emails (ACC-02, ACC-07). */
@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}

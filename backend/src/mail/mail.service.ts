import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Injection token, so tests can swap in a fake inbox. */
/**
 * Sends account emails (ACC-02 verification link, ACC-07 reset link) over
 * SMTP, using a TEST inbox in development:
 *  - SMTP_HOST/PORT/USER/PASS set in backend/.env (e.g. a Mailtrap inbox):
 *    those are used.
 *  - Not set: a free Ethereal test inbox is created on first use (no sign-up)
 *    and every email is logged with a link to read it in the browser.
 * Nothing is ever sent to a real mailbox unless real SMTP settings are given.
 * Added by Youssef Khafagy for the ACC-02 / ACC-07 bonuses.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter?: Promise<Transporter>;

  constructor(private readonly config: ConfigService) {}

  async send(message: MailMessage): Promise<void> {
    const transporter = await this.transport();
    const info = (await transporter.sendMail({
      from:
        this.config.get<string>('MAIL_FROM') ??
        'Travel Platform <no-reply@travel-platform.test>',
      ...message,
    })) as Parameters<typeof nodemailer.getTestMessageUrl>[0];
    const preview = nodemailer.getTestMessageUrl(info);
    // Never log the message body: it contains a one-time link.
    if (preview)
      this.logger.log(`Test email "${message.subject}" -> open ${preview}`);
  }

  private transport(): Promise<Transporter> {
    this.transporter ??= this.createTransport().catch((e: unknown) => {
      this.transporter = undefined; // try again next time
      throw e;
    });
    return this.transporter;
  }

  private async createTransport(): Promise<Transporter> {
    const host = this.config.get<string>('SMTP_HOST');
    if (host) {
      return nodemailer.createTransport({
        host,
        port: Number(this.config.get<string>('SMTP_PORT') ?? 587),
        auth: {
          user: this.config.get<string>('SMTP_USER'),
          pass: this.config.get<string>('SMTP_PASS'),
        },
      });
    }
    const account = await nodemailer.createTestAccount();
    this.logger.log(
      `No SMTP_HOST set: using the Ethereal test inbox ${account.user}`,
    );
    return nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: { user: account.user, pass: account.pass },
    });
  }
}

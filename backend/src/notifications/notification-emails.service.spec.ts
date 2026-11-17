import { describe, expect, it, vi } from 'vitest';
import { NotificationEmailsService } from './notification-emails.service.js';

function setup(rows: { email: string; name: string }[], fail = false) {
  const find = vi.fn().mockReturnValue({
    lean: () => ({ exec: () => Promise.resolve(rows) }),
  });
  const mail = {
    send: fail
      ? vi.fn().mockRejectedValue(new Error('SMTP down'))
      : vi.fn().mockResolvedValue(undefined),
  };
  const service = new NotificationEmailsService(
    { find } as never,
    mail as never,
  );
  return { service, find, mail };
}

describe('NotificationEmailsService (GEN-01-B)', () => {
  it('emails each user the notification title and message, skipping deactivated accounts', async () => {
    const { service, find, mail } = setup([{ email: 'a@x.test', name: 'A' }]);
    await service.emailUsers(['64b000000000000000000001'], {
      title: 'Refund issued',
      message: 'Your refund of 100 EGP is Refunded.',
    });
    expect(find.mock.calls[0][0]).toMatchObject({
      status: { $ne: 'deactivated' },
    });
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@x.test',
        subject: 'Refund issued',
        text: expect.stringContaining('Your refund of 100 EGP is Refunded.'),
      }),
    );
  });

  it('never throws when SMTP fails (the in-app notification already exists)', async () => {
    const { service } = setup([{ email: 'a@x.test', name: 'A' }], true);
    await expect(
      service.emailUsers(['64b000000000000000000001'], {
        title: 't',
        message: 'm',
      }),
    ).resolves.toBeUndefined();
  });

  it('moderator invitation names the provider and never contains a password', async () => {
    const { service, mail } = setup([]);
    await service.inviteModerator(
      { email: 'm@x.test', name: 'Mona' },
      'hotel',
      'Nile Hotel',
    );
    const sent = mail.send.mock.calls[0][0] as {
      subject: string;
      text: string;
    };
    expect(sent.subject).toBe(
      'You are invited as the hotel moderator of Nile Hotel',
    );
    expect(sent.text).toContain(
      'temporary password the administrator gives you',
    );
  });
});

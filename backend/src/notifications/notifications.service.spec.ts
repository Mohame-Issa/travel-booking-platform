import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../common/constants/error-codes.js';
import { NotificationsService } from './notifications.service.js';

const USER = '64b000000000000000000001';
const OTHER = '64b000000000000000000002';
const NOTE = '64b0000000000000000000c1';
const base = { type: 'refund_issued' as const, title: 'T', message: 'M' };

function exec<T>(value: T) {
  return { exec: () => Promise.resolve(value) };
}

function setup(found: Record<string, unknown> | null = null) {
  const model = {
    create: vi.fn().mockResolvedValue({}),
    insertMany: vi.fn().mockResolvedValue([]),
    findOne: vi.fn().mockReturnValue(exec(found)),
    updateMany: vi.fn().mockReturnValue(exec({ modifiedCount: 2 })),
  };
  return { model, service: new NotificationsService(model as never) };
}

describe('NotificationsService (GEN-01)', () => {
  it('notify persists one unread notification for the user', async () => {
    const { model, service } = setup();
    await service.notify({ ...base, userId: USER, data: { refundId: 'r1' } });
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        ...base,
        data: { refundId: 'r1' },
      }),
    );
  });

  it('notifyMany writes one row per distinct user and skips an empty list', async () => {
    const { model, service } = setup();
    await service.notifyMany([USER, OTHER, USER], base);
    expect(model.insertMany.mock.calls[0][0]).toHaveLength(2);
    await service.notifyMany([], base);
    expect(model.insertMany).toHaveBeenCalledTimes(1);
  });

  it("markRead hides other users' notifications as 404 and is idempotent", async () => {
    const missing = setup(null);
    await expect(missing.service.markRead(USER, NOTE)).rejects.toMatchObject({
      response: { code: ErrorCode.NOT_FOUND },
    });
    expect(missing.model.findOne).toHaveBeenCalledWith({
      _id: NOTE,
      userId: USER,
    });

    const readAt = new Date('2026-01-01T00:00:00Z');
    const save = vi.fn();
    const already = setup({ readAt, save });
    expect((await already.service.markRead(USER, NOTE)).readAt).toBe(readAt);
    expect(save).not.toHaveBeenCalled();

    const fresh = setup({ readAt: null, save });
    expect((await fresh.service.markRead(USER, NOTE)).readAt).toBeInstanceOf(
      Date,
    );
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("markAllRead only touches the caller's unread rows", async () => {
    const { model, service } = setup();
    await expect(service.markAllRead(USER)).resolves.toEqual({ updated: 2 });
    expect(model.updateMany.mock.calls[0][0]).toEqual({
      userId: USER,
      readAt: null,
    });
  });
});

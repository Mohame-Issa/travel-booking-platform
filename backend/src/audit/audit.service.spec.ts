import { describe, expect, it, vi } from 'vitest';
import { AuditLogService } from './audit.service.js';

describe('AuditLogService (GEN-07)', () => {
  it('record persists the action without dropping fields', async () => {
    const model = { create: vi.fn().mockResolvedValue({}) };
    const service = new AuditLogService(model as never);
    const input = {
      actorId: '64b000000000000000000001',
      action: 'user.password_reset',
      targetType: 'User',
      targetId: '64b000000000000000000002',
      details: { reason: 'locked out' },
    };
    await service.record(input);
    expect(model.create).toHaveBeenCalledWith(input);
  });

  it('record surfaces database errors instead of silently losing the entry', async () => {
    const model = { create: vi.fn().mockRejectedValue(new Error('db down')) };
    await expect(
      new AuditLogService(model as never).record({
        actorId: '64b000000000000000000001',
        action: 'x.y',
        targetType: 'X',
      }),
    ).rejects.toThrow('db down');
  });
});

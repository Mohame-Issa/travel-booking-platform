import { describe, expect, it, vi } from 'vitest';
import { UploadAirlineLogoResolver } from './airline-logo.resolver.js';

const USER = '64b000000000000000000001';
const ASSET = '64b0000000000000000000a1';
const AIRLINE = '64b0000000000000000000b1';

function setup(asset: Record<string, unknown>) {
  const uploads = {
    findOwned: vi.fn().mockResolvedValue(asset),
    detachOwner: vi.fn().mockResolvedValue([]),
    restore: vi.fn().mockResolvedValue(undefined),
    attach: vi.fn().mockResolvedValue('/api/uploads/files/new.png'),
  };
  return { uploads, resolver: new UploadAirlineLogoResolver(uploads as never) };
}

describe('UploadAirlineLogoResolver (FLT-01, GEN-08: 1 logo per airline)', () => {
  it('replaces the previous logo and returns the served URL', async () => {
    const { uploads, resolver } = setup({ _id: ASSET, ownerId: null });
    await expect(resolver.resolve(ASSET, USER, AIRLINE)).resolves.toBe(
      '/api/uploads/files/new.png',
    );
    const owner = { type: 'airline', id: AIRLINE };
    expect(uploads.findOwned).toHaveBeenCalledWith(ASSET, USER);
    expect(uploads.detachOwner).toHaveBeenCalledWith(owner);
    expect(uploads.attach).toHaveBeenCalledWith(ASSET, USER, owner);
    expect(uploads.detachOwner.mock.invocationCallOrder[0]).toBeLessThan(
      uploads.attach.mock.invocationCallOrder[0],
    );
  });

  it('never detaches the current logo for an asset that is already attached', async () => {
    const { uploads, resolver } = setup({ _id: ASSET, ownerId: 'somewhere' });
    await resolver.resolve(ASSET, USER, AIRLINE);
    expect(uploads.detachOwner).not.toHaveBeenCalled();
    expect(uploads.attach).toHaveBeenCalled();
  });

  it('puts the previous logo back when attaching the new one fails', async () => {
    const { uploads, resolver } = setup({ _id: ASSET, ownerId: null });
    const previous = [{ _id: 'old', slot: 0 }];
    uploads.detachOwner.mockResolvedValue(previous);
    uploads.attach.mockRejectedValue(new Error('IMAGE_LIMIT_REACHED'));
    await expect(resolver.resolve(ASSET, USER, AIRLINE)).rejects.toThrow(
      'IMAGE_LIMIT_REACHED',
    );
    expect(uploads.restore).toHaveBeenCalledWith(previous, {
      type: 'airline',
      id: AIRLINE,
    });
  });

  it('keeps the original attach error when restoring the old logo also fails', async () => {
    const { uploads, resolver } = setup({ _id: ASSET, ownerId: null });
    uploads.detachOwner.mockResolvedValue([{ _id: 'old', slot: 0 }]);
    uploads.attach.mockRejectedValue(new Error('IMAGE_LIMIT_REACHED'));
    uploads.restore.mockRejectedValue(new Error('E11000 duplicate key'));
    await expect(resolver.resolve(ASSET, USER, AIRLINE)).rejects.toThrow(
      'IMAGE_LIMIT_REACHED',
    );
  });

  it('propagates ownership and not-found errors before touching the current logo', async () => {
    const { uploads, resolver } = setup({});
    uploads.findOwned.mockRejectedValue(new Error('NOT_RESOURCE_OWNER'));
    await expect(resolver.resolve(ASSET, USER, AIRLINE)).rejects.toThrow(
      'NOT_RESOURCE_OWNER',
    );
    expect(uploads.detachOwner).not.toHaveBeenCalled();
  });
});

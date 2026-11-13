import { mkdtempSync, readdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PayloadTooLargeException } from '@nestjs/common';
import { lastValueFrom, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ImageTooLargeInterceptor } from './image-too-large.interceptor.js';
import { MAX_UNATTACHED_PER_USER, UploadsService } from './uploads.service.js';
import { MAX_IMAGE_BYTES } from './image-type.js';

// stat delegates to the real one unless a test injects a failure
vi.mock('node:fs/promises', async (orig) => {
  const real = await orig<typeof import('node:fs/promises')>();
  return { ...real, stat: vi.fn(real.stat) };
});

const USER = '64b000000000000000000001';
const OTHER = '64b000000000000000000002';
const ASSET = '64b0000000000000000000a1';
const HOTEL = '64b0000000000000000000c1';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

function exec<T>(value: T) {
  return { exec: () => Promise.resolve(value) };
}

function setup(asset: Record<string, unknown> | null = null) {
  const dir = mkdtempSync(join(tmpdir(), 'uploads-spec-'));
  const model = {
    create: vi
      .fn()
      .mockImplementation((doc: Record<string, unknown>) =>
        Promise.resolve({ ...doc, id: ASSET }),
      ),
    findById: vi.fn().mockReturnValue(exec(asset)),
    updateOne: vi.fn().mockReturnValue(exec({ matchedCount: 1 })),
    updateMany: vi.fn().mockReturnValue(exec({ matchedCount: 1 })),
    countDocuments: vi.fn().mockReturnValue(exec(0)),
    find: vi
      .fn()
      .mockReturnValue({ lean: () => exec([{ _id: 'old', slot: 0 }]) }),
  };
  const config = { get: () => dir };
  const service = new UploadsService(model as never, config as never);
  return { service, model, dir };
}

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return (e as { getResponse(): { code: string } }).getResponse().code;
  }
  throw new Error('expected a rejection');
}

describe('UploadsService.store (GEN-08)', () => {
  it('writes a PNG under a random name and returns its served URL', async () => {
    const { service, model, dir } = setup();
    const res = await service.store({ buffer: PNG, size: PNG.length }, USER);
    expect(res.url).toMatch(/^\/api\/uploads\/files\/[0-9a-f-]{36}\.png$/);
    expect(readdirSync(dir)).toHaveLength(1);
    expect(model.create.mock.calls[0][0]).toMatchObject({
      mimeType: 'image/png',
      size: PNG.length,
    });
  });

  it('rejects non JPG/PNG content and oversize files without writing anything', async () => {
    const { service, dir } = setup();
    const gif = Buffer.from('GIF89a....');
    expect(
      await code(service.store({ buffer: gif, size: gif.length }, USER)),
    ).toBe(ErrorCode.UNSUPPORTED_IMAGE_TYPE);
    expect(
      await code(
        service.store({ buffer: PNG, size: MAX_IMAGE_BYTES + 1 }, USER),
      ),
    ).toBe(ErrorCode.IMAGE_TOO_LARGE);
    expect(await code(service.store(undefined, USER))).toBe(
      ErrorCode.VALIDATION_FAILED,
    );
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('caps unattached uploads per user so one account cannot fill the disk', async () => {
    const { service, model, dir } = setup();
    model.countDocuments.mockReturnValue(exec(MAX_UNATTACHED_PER_USER));
    expect(
      await code(service.store({ buffer: PNG, size: PNG.length }, USER)),
    ).toBe(ErrorCode.IMAGE_LIMIT_REACHED);
    expect(model.countDocuments).toHaveBeenCalledWith({
      uploaderId: USER,
      ownerId: null,
    });
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('removes the written file and keeps the original error when the row cannot be saved', async () => {
    const { service, model, dir } = setup();
    model.create.mockRejectedValue(new Error('db down'));
    await expect(
      service.store({ buffer: PNG, size: PNG.length }, USER),
    ).rejects.toThrow('db down');
    expect(readdirSync(dir)).toHaveLength(0);
  });
});

describe('UploadsService.detach', () => {
  it('answers ASSET_NOT_FOUND for a malformed id instead of a cast error', async () => {
    const { service, model } = setup();
    expect(
      await code(service.detach('nope', { type: 'hotel', id: HOTEL })),
    ).toBe(ErrorCode.ASSET_NOT_FOUND);
    expect(model.updateOne).not.toHaveBeenCalled();
  });
});

describe('UploadsService.detachOwner / restore (logo replacement rollback)', () => {
  it('returns the rows it detached and restore re-attaches them to the same slots', async () => {
    const { service, model } = setup();
    const owner = { type: 'airline' as const, id: HOTEL };
    const rows = await service.detachOwner(owner);
    expect(rows).toEqual([{ _id: 'old', slot: 0 }]);
    expect(model.updateMany.mock.calls[0][0]).toMatchObject({
      _id: { $in: ['old'] },
    });
    await service.restore(rows, owner);
    expect(model.updateOne).toHaveBeenCalledWith(
      { _id: 'old', ownerId: null },
      { $set: { ownerType: 'airline', ownerId: HOTEL, slot: 0 } },
    );
  });
});

describe('UploadsService.attach (GEN-08 counts and ownership)', () => {
  const owned = () => ({
    _id: ASSET,
    uploaderId: { toString: () => USER },
    storedName: 'x.png',
    ownerId: null,
  });

  it('rejects unknown, foreign and already-attached assets', async () => {
    const owner = { type: 'hotel' as const, id: HOTEL };
    expect(await code(setup(null).service.attach(ASSET, USER, owner))).toBe(
      ErrorCode.ASSET_NOT_FOUND,
    );
    expect(await code(setup(null).service.attach('nope', USER, owner))).toBe(
      ErrorCode.ASSET_NOT_FOUND,
    );
    expect(await code(setup(owned()).service.attach(ASSET, OTHER, owner))).toBe(
      ErrorCode.NOT_RESOURCE_OWNER,
    );
    const elsewhere = {
      ...owned(),
      ownerType: 'post',
      ownerId: { toString: () => OTHER },
    };
    expect(
      await code(setup(elsewhere).service.attach(ASSET, USER, owner)),
    ).toBe(ErrorCode.ASSET_IN_USE);
  });

  it('is a no-op when the asset is already attached to the same owner', async () => {
    const same = {
      ...owned(),
      ownerType: 'hotel',
      ownerId: { toString: () => HOTEL },
    };
    const { service, model } = setup(same);
    expect(
      await service.attach(ASSET, USER, { type: 'hotel', id: HOTEL }),
    ).toBe('/api/uploads/files/x.png');
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('claims the next slot when a slot is taken and stops at the GEN-08 limit', async () => {
    const { service, model } = setup(owned());
    const dup = Object.assign(new Error('dup'), { code: 11000 });
    model.updateOne
      .mockReturnValueOnce({ exec: () => Promise.reject(dup) })
      .mockReturnValueOnce(exec({ matchedCount: 1 }));
    await service.attach(ASSET, USER, { type: 'hotel', id: HOTEL });
    expect(model.updateOne.mock.calls[1][1]).toMatchObject({
      $set: { slot: 1 },
    });

    const full = setup(owned());
    full.model.updateOne.mockReturnValue({ exec: () => Promise.reject(dup) });
    expect(
      await code(
        full.service.attach(ASSET, USER, { type: 'hotel', id: HOTEL }),
      ),
    ).toBe(ErrorCode.IMAGE_LIMIT_REACHED);
    expect(full.model.updateOne).toHaveBeenCalledTimes(5);
  });

  it('reports ASSET_IN_USE when another request attached it first', async () => {
    const { service, model } = setup(owned());
    model.updateOne.mockReturnValue(exec({ matchedCount: 0 }));
    expect(
      await code(service.attach(ASSET, USER, { type: 'hotel', id: HOTEL })),
    ).toBe(ErrorCode.ASSET_IN_USE);
  });
});

describe('UploadsService.openFile', () => {
  it('refuses names that are not generated upload names', async () => {
    const { service } = setup();
    for (const name of ['../.env', 'a.png', 'x/../../y.jpg']) {
      expect(await code(service.openFile(name))).toBe(
        ErrorCode.ASSET_NOT_FOUND,
      );
    }
  });

  it('answers 404 only for a missing file, and surfaces other storage errors', async () => {
    const { service } = setup();
    const name = '00000000-0000-4000-8000-000000000000.png';
    expect(await code(service.openFile(name))).toBe(ErrorCode.ASSET_NOT_FOUND);
    // permissions / bad mount: an operations fault, not "not found"
    vi.mocked(stat).mockRejectedValueOnce(
      Object.assign(new Error('denied'), { code: 'EACCES' }),
    );
    await expect(service.openFile(name)).rejects.toMatchObject({
      code: 'EACCES',
    });
  });
});

describe('ImageTooLargeInterceptor', () => {
  it('turns multer 413 into the shared IMAGE_TOO_LARGE error and passes others through', async () => {
    const run = (err: unknown) =>
      lastValueFrom(
        new ImageTooLargeInterceptor().intercept({} as never, {
          handle: () => throwError(() => err),
        }),
      );
    expect(
      await code(run(new PayloadTooLargeException('File too large'))),
    ).toBe(ErrorCode.IMAGE_TOO_LARGE);
    const other = new Error('other');
    await expect(run(other)).rejects.toBe(other);
  });
});

import { describe, expect, it } from 'vitest';
import { detectImageType } from './image-type.js';

describe('detectImageType (GEN-08)', () => {
  it('detects PNG and JPEG by their magic bytes', () => {
    expect(
      detectImageType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe('png');
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe(
      'jpg',
    );
  });

  it('rejects other formats, text and empty files', () => {
    expect(detectImageType(Buffer.from('GIF89a'))).toBeNull();
    expect(detectImageType(Buffer.from('<svg></svg>'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});

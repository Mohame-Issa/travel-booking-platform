/** GEN-08: JPG or PNG, up to 5 MB each. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** GEN-08 per-owner counts: 5 per post, activity or hotel; 1 logo per airline. */
export const IMAGE_LIMITS = {
  airline: 1,
  hotel: 5,
  post: 5,
  activity: 5,
} as const;
export type UploadOwnerType = keyof typeof IMAGE_LIMITS;

export type ImageExt = 'png' | 'jpg';
export const MIME_BY_EXT: Record<ImageExt, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
};

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** Trusts the file's magic bytes, never the client's filename or Content-Type. */
export function detectImageType(buf: Buffer): ImageExt | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return 'jpg';
  return null;
}

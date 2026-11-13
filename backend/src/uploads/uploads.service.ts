import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { HttpStatus, Injectable, Logger, StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import {
  detectImageType,
  IMAGE_LIMITS,
  MAX_IMAGE_BYTES,
  MIME_BY_EXT,
  type UploadOwnerType,
} from './image-type.js';
import { Upload, type UploadDocument } from './schemas/upload.schema.js';

/** The part of a multer file we use (avoids adding @types/multer). */
export interface IncomingImage {
  buffer: Buffer;
  size: number;
}

export interface DetachedImage {
  _id: unknown;
  slot: number | null;
}

export interface UploadOwner {
  type: UploadOwnerType;
  id: string;
}

/** shortcut: a fixed cap of unattached uploads per user instead of rate limiting / an orphan sweep; upgrade if uploads become heavy. */
export const MAX_UNATTACHED_PER_USER = 20;

const logger = new Logger('UploadsService');

const STORED_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$/;

/**
 * GEN-08 shared image upload. Flow for any owner module:
 *   1. client POST /api/uploads -> { id, url }
 *   2. owner endpoint receives the id and calls attach(id, user.id, { type, id }) -> url
 *   3. removing an image: detach(id, owner)
 */
@Injectable()
export class UploadsService {
  private readonly dir: string;

  constructor(
    @InjectModel(Upload.name) private readonly uploads: Model<Upload>,
    config: ConfigService,
  ) {
    this.dir = resolve(config.get<string>('UPLOAD_DIR') || 'uploads');
  }

  static url(storedName: string) {
    return `/api/uploads/files/${storedName}`;
  }

  async store(file: IncomingImage | undefined, uploaderId: string) {
    if (!file)
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Attach an image in the "file" field',
        [{ field: 'file', messages: ['file is required'] }],
      );
    if (file.size > MAX_IMAGE_BYTES)
      throw new ApiException(
        HttpStatus.PAYLOAD_TOO_LARGE,
        ErrorCode.IMAGE_TOO_LARGE,
        'Images must be 5 MB or smaller',
      );
    const ext = detectImageType(file.buffer);
    if (!ext)
      throw new ApiException(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        ErrorCode.UNSUPPORTED_IMAGE_TYPE,
        'Only JPG and PNG images are accepted',
      );

    const unattached = await this.uploads
      .countDocuments({ uploaderId, ownerId: null })
      .exec();
    if (unattached >= MAX_UNATTACHED_PER_USER)
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.IMAGE_LIMIT_REACHED,
        `You have ${unattached} unused uploads; attach or remove some before uploading more`,
      );

    const storedName = `${randomUUID()}.${ext}`;
    const path = join(this.dir, storedName);
    await mkdir(this.dir, { recursive: true });
    try {
      await writeFile(path, file.buffer);
      const doc = await this.uploads.create({
        uploaderId,
        storedName,
        mimeType: MIME_BY_EXT[ext],
        size: file.size,
      });
      return {
        id: String(doc.id),
        url: UploadsService.url(storedName),
        mimeType: MIME_BY_EXT[ext],
        size: file.size,
      };
    } catch (err) {
      // no orphan file without a row; a cleanup failure must not hide the real error
      await rm(path, { force: true }).catch((e: Error) =>
        logger.warn(`Could not remove ${storedName}: ${e.message}`),
      );
      throw err;
    }
  }

  /** The asset, if it exists and was uploaded by actorId. */
  async findOwned(assetId: string, actorId: string): Promise<UploadDocument> {
    const asset = isValidObjectId(assetId)
      ? await this.uploads.findById(assetId).exec()
      : null;
    if (!asset)
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.ASSET_NOT_FOUND,
        'Uploaded image not found',
      );
    if (asset.uploaderId.toString() !== actorId)
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.NOT_RESOURCE_OWNER,
        'You can only use images you uploaded',
      );
    return asset;
  }

  /** Attaches an owned, unattached image to an entity within its GEN-08 count. Returns the served URL. */
  async attach(
    assetId: string,
    actorId: string,
    owner: UploadOwner,
  ): Promise<string> {
    const asset = await this.findOwned(assetId, actorId);
    const url = UploadsService.url(asset.storedName);
    if (asset.ownerId) {
      if (
        asset.ownerType === owner.type &&
        asset.ownerId.toString() === owner.id
      )
        return url;
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.ASSET_IN_USE,
        'This image is already used elsewhere',
      );
    }
    for (let slot = 0; slot < IMAGE_LIMITS[owner.type]; slot++) {
      try {
        const res = await this.uploads
          .updateOne(
            { _id: asset._id, ownerId: null },
            { $set: { ownerType: owner.type, ownerId: owner.id, slot } },
          )
          .exec();
        if (res.matchedCount === 0)
          throw new ApiException(
            HttpStatus.CONFLICT,
            ErrorCode.ASSET_IN_USE,
            'This image is already used elsewhere',
          );
        return url;
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err; // slot taken: try the next one
      }
    }
    throw new ApiException(
      HttpStatus.CONFLICT,
      ErrorCode.IMAGE_LIMIT_REACHED,
      `A ${owner.type} can have at most ${IMAGE_LIMITS[owner.type]} image(s)`,
    );
  }

  /** Frees one image from an entity. The file stays on disk. */
  async detach(assetId: string, owner: UploadOwner): Promise<void> {
    if (!isValidObjectId(assetId))
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.ASSET_NOT_FOUND,
        'Uploaded image not found',
      );
    await this.uploads
      .updateOne(
        { _id: assetId, ownerType: owner.type, ownerId: owner.id },
        { $set: { ownerType: null, ownerId: null, slot: null } },
      )
      .exec();
  }

  /** Frees the image served at `url` from an entity (e.g. a removed hotel photo). */
  async detachUrl(url: string, owner: UploadOwner): Promise<void> {
    const storedName = url.split('/').pop() ?? '';
    if (!STORED_NAME.test(storedName)) return; // not one of ours (e.g. seeded photo URL)
    await this.uploads
      .updateOne(
        { storedName, ownerType: owner.type, ownerId: owner.id },
        { $set: { ownerType: null, ownerId: null, slot: null } },
      )
      .exec();
  }

  /** Frees every image of an entity (e.g. before replacing an airline logo); returns them for restore(). */
  async detachOwner(owner: UploadOwner): Promise<DetachedImage[]> {
    const rows = await this.uploads
      .find({ ownerType: owner.type, ownerId: owner.id }, { _id: 1, slot: 1 })
      .lean<DetachedImage[]>()
      .exec();
    if (rows.length)
      await this.uploads
        .updateMany(
          {
            _id: { $in: rows.map((r) => r._id) },
            ownerType: owner.type,
            ownerId: owner.id,
          },
          { $set: { ownerType: null, ownerId: null, slot: null } },
        )
        .exec();
    return rows;
  }

  /** Undoes detachOwner when the replacement could not be attached. */
  async restore(rows: DetachedImage[], owner: UploadOwner): Promise<void> {
    for (const { _id, slot } of rows)
      await this.uploads
        .updateOne(
          { _id, ownerId: null },
          { $set: { ownerType: owner.type, ownerId: owner.id, slot } },
        )
        .exec();
  }

  /** Streams a stored image. Only generated names are accepted, so no path traversal. */
  async openFile(name: string): Promise<StreamableFile> {
    const notFound = new ApiException(
      HttpStatus.NOT_FOUND,
      ErrorCode.ASSET_NOT_FOUND,
      'Image not found',
    );
    const match = STORED_NAME.exec(name);
    if (!match) throw notFound;
    const path = join(this.dir, name);
    try {
      await stat(path);
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') throw notFound;
      throw err; // permissions / wrong UPLOAD_DIR: an operations fault, logged by the filter as 500
    }
    return new StreamableFile(createReadStream(path), {
      type: MIME_BY_EXT[match[1] as 'png' | 'jpg'],
      disposition: 'inline',
    });
  }
}

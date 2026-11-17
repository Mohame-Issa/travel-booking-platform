import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { UploadsService } from '../uploads/uploads.service.js';
import type {
  CreateActivityDto,
  UpdateActivityDto,
} from './dto/activity.dto.js';
import type { ActivityDto } from './dto/day.dto.js';
import { ItineraryDaysService } from './itinerary-days.service.js';
import { Activity, type ActivityDocument } from './schemas/activity.schema.js';

/**
 * Activities of a day (ITN-10) and their images (ITN-12, GEN-08). Images go
 * through Mohamed Hashad's shared upload service: the client uploads with
 * POST /api/uploads, then attaches the returned id here. The upload service
 * enforces JPG/PNG, 5 MB and at most 5 images per activity.
 */
@Injectable()
export class ActivitiesService {
  constructor(
    @InjectModel(Activity.name) private readonly activities: Model<Activity>,
    private readonly days: ItineraryDaysService,
    private readonly uploads: UploadsService,
  ) {}

  /** POST /api/itineraries/:id/days/:dayId/activities */
  async create(
    itineraryId: string,
    dayId: string,
    dto: CreateActivityDto,
  ): Promise<ActivityDto> {
    const day = await this.days.findInItinerary(itineraryId, dayId);
    assertCostAndCurrency(dto.cost ?? null, dto.currency ?? null);
    const activity = await this.activities.create({
      itineraryId: day.itineraryId,
      dayId: day._id,
      userId: day.userId,
      name: dto.name,
      description: dto.description ?? '',
      time: dto.time ?? null,
      cost: dto.cost ?? null,
      currency: dto.currency ?? null,
    });
    await this.days.touch(day.itineraryId);
    return toActivityDto(activity);
  }

  /** PATCH /api/activities/:id (owner checked by @CheckOwnership). */
  async update(id: string, dto: UpdateActivityDto): Promise<ActivityDto> {
    const activity = await this.findOrFail(id);
    if (dto.name !== undefined) activity.name = dto.name;
    if (dto.description !== undefined) activity.description = dto.description;
    if (dto.time !== undefined) activity.time = dto.time;
    if (dto.cost !== undefined) activity.cost = dto.cost;
    if (dto.currency !== undefined) activity.currency = dto.currency;
    assertCostAndCurrency(activity.cost, activity.currency);
    await activity.save();
    await this.days.touch(activity.itineraryId);
    return toActivityDto(activity);
  }

  /** DELETE /api/activities/:id: also frees its images (GEN-08). */
  async remove(id: string): Promise<void> {
    const activity = await this.activities.findByIdAndDelete(id).exec();
    if (!activity) throw new NotFoundException('Activity not found');
    await this.uploads.detachOwner({ type: 'activity', id });
    await this.days.touch(activity.itineraryId);
  }

  /** POST /api/activities/:id/images (ITN-12). */
  async attachImage(
    id: string,
    userId: string,
    imageId: string,
  ): Promise<ActivityDto> {
    const activity = await this.findOrFail(id);
    // Checks the user uploaded it, it is unused, and the 5-image limit (GEN-08).
    const url = await this.uploads.attach(imageId, userId, {
      type: 'activity',
      id,
    });
    const updated = await this.activities
      .findOneAndUpdate(
        {
          _id: activity._id,
          'images.imageId': { $ne: new Types.ObjectId(imageId) },
        },
        { $push: { images: { imageId: new Types.ObjectId(imageId), url } } },
        { new: true },
      )
      .exec();
    return toActivityDto(updated ?? activity); // already attached: unchanged
  }

  /** DELETE /api/activities/:id/images/:imageId (ITN-12). */
  async detachImage(id: string, imageId: string): Promise<ActivityDto> {
    const activity = await this.findOrFail(id);
    if (!activity.images.some((i) => i.imageId.toString() === imageId)) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.ASSET_NOT_FOUND,
        'Image not found on this activity',
      );
    }
    await this.uploads.detach(imageId, { type: 'activity', id });
    const updated = await this.activities
      .findByIdAndUpdate(
        id,
        { $pull: { images: { imageId: new Types.ObjectId(imageId) } } },
        { new: true },
      )
      .exec();
    return toActivityDto(updated ?? activity);
  }

  private async findOrFail(id: string): Promise<ActivityDocument> {
    const activity = await this.activities.findById(id).exec();
    if (!activity) throw new NotFoundException('Activity not found');
    return activity;
  }
}

/** A cost needs a currency and a currency needs a cost (ITN-10, ITN-14). */
function assertCostAndCurrency(
  cost: number | null,
  currency: string | null,
): void {
  if ((cost === null) !== (currency === null)) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_FAILED,
      'Validation failed',
      [
        {
          field: cost === null ? 'cost' : 'currency',
          messages: ['cost and currency must be given together'],
        },
      ],
    );
  }
}

export function toActivityDto(
  a: Activity & { _id: Types.ObjectId },
): ActivityDto {
  return {
    id: a._id.toString(),
    dayId: a.dayId.toString(),
    name: a.name,
    description: a.description,
    time: a.time,
    cost: a.cost,
    currency: a.currency,
    images: a.images.map((i) => ({
      imageId: i.imageId.toString(),
      url: i.url,
    })),
  };
}

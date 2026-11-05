import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { ErrorCode } from '../common/constants/error-codes.js';
import {
  MODERATOR_ROLE_FOR_PROVIDER,
  ProviderType,
  UserRole,
} from '../common/constants/roles.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { ModeratorAssignment } from './schemas/moderator-assignment.schema.js';

/**
 * Reads moderator assignments. Exported globally by UsersModule, so any
 * module can inject it without importing UsersModule.
 */
@Injectable()
export class ModeratorAssignmentsService {
  constructor(
    @InjectModel(ModeratorAssignment.name)
    private readonly assignmentModel: Model<ModeratorAssignment>,
  ) {}

  /** The provider a moderator manages, or null if they have no assignment. */
  async findByModerator(
    moderatorId: string,
  ): Promise<{ providerType: ProviderType; providerId: string } | null> {
    const a = await this.assignmentModel
      .findOne({ moderatorId: new Types.ObjectId(moderatorId) })
      .lean()
      .exec();
    return a
      ? { providerType: a.providerType, providerId: String(a.providerId) }
      : null;
  }

  /**
   * Throws 403 unless `user` may manage the given provider.
   * Admins always pass; moderators only for their assigned provider.
   *
   * Use this in services when the provider id is not in the URL, e.g.:
   *   const flight = await this.flightModel.findById(id);
   *   await this.assignments.assertCanManage(user, ProviderType.AIRLINE, String(flight.airlineId));
   */
  async assertCanManage(
    user: AuthenticatedUser,
    providerType: ProviderType,
    providerId: string,
  ): Promise<void> {
    if (user.role === UserRole.ADMIN) return;

    const deny = () =>
      new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.NOT_ASSIGNED_PROVIDER,
        `You can only manage your assigned ${providerType}`,
      );

    if (user.role !== MODERATOR_ROLE_FOR_PROVIDER[providerType]) throw deny();
    if (!isValidObjectId(providerId)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.INVALID_ID,
        `Invalid ${providerType} id`,
      );
    }

    const assigned = await this.assignmentModel.exists({
      moderatorId: new Types.ObjectId(user.id),
      providerType,
      providerId: new Types.ObjectId(providerId),
    });
    if (!assigned) throw deny();
  }
}

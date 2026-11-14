
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { AuthService } from '../auth/auth.service.js';
import { ErrorCode } from '../common/constants/error-codes.js';
import { PAGE_SIZE } from '../common/constants/pagination.js';
import {
  Paginated,
} from '../common/dto/pagination.dto.js';
import {
  MODERATOR_ROLE_FOR_PROVIDER,
  ProviderType,
  UserStatus,
} from '../common/constants/roles.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import {
  AUDIT_SERVICE,
  type AuditService,
} from '../common/interfaces/audit.interface.js';

import { Airline } from '../airlines/schemas/airline.schema.js';
import { Hotel } from '../hotels/schemas/hotel.schema.js';
import { ModeratorAssignment } from '../users/schemas/moderator-assignment.schema.js';
import { User, UserDocument } from '../users/schemas/user.schema.js';

import { CreateModeratorDto } from './dto/create-moderator.dto.js';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto.js';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<User>,

    @InjectModel(ModeratorAssignment.name)
    private readonly assignmentModel: Model<ModeratorAssignment>,

    @InjectModel(Airline.name)
    private readonly airlineModel: Model<Airline>,

    @InjectModel(Hotel.name)
    private readonly hotelModel: Model<Hotel>,

    private readonly auth: AuthService,

    @Inject(AUDIT_SERVICE)
    private readonly audit: AuditService,
  ) {}

  /**
   * ACC-14: List all accounts with pagination, search and filters.
   */
  async listAccounts(
    query: ListAccountsQueryDto,
  ): Promise<Paginated<UserDocument>> {
    const { page = 1, search, role, status } = query;

    const filter: Record<string, unknown> = {};

    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      filter.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { email: { $regex: escapedSearch, $options: 'i' } },
      ];
    }

    if (role) {
      filter.role = role;
    }

    if (status) {
      filter.status = status;
    }

    const skip = (page - 1) * PAGE_SIZE;

    const [accounts, totalItems] = await Promise.all([
      this.userModel
        .find(filter)
        .select(
          'name email role status phone preferredCurrency mustChangePassword createdAt',
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(PAGE_SIZE)
        .exec(),

      this.userModel.countDocuments(filter).exec(),
    ]);

    return {
      items: accounts,
      meta: {
        page,
        pageSize: PAGE_SIZE,
        totalItems,
        totalPages: Math.ceil(totalItems / PAGE_SIZE),
      },
    };
  }

  /**
   * ACC-13: name, email and a temporary password set by the admin; the
   * moderator must change it on first login (mustChangePassword). The unique
   * moderatorId index on ModeratorAssignment guarantees exactly one provider.
   * The action is recorded through the audit service (GEN-07).
   */
  async createModerator(
    adminId: string,
    dto: CreateModeratorDto,
  ): Promise<UserDocument> {
    const existingUser = await this.userModel
      .findOne({ email: dto.email })
      .exec();

    if (existingUser) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.EMAIL_ALREADY_REGISTERED,
        'An account with this email address already exists',
      );
    }

    const provider =
      dto.providerType === ProviderType.AIRLINE
        ? await this.airlineModel.exists({ _id: dto.providerId })
        : await this.hotelModel.exists({ _id: dto.providerId });

    if (!provider) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'The selected airline or hotel was not found',
      );
    }

    const passwordHash = await this.auth.hashPassword(dto.password);

    let moderator: UserDocument;

    try {
      moderator = await this.userModel.create({
        name: dto.name,
        email: dto.email,
        passwordHash,
        role: MODERATOR_ROLE_FOR_PROVIDER[dto.providerType],
        status: UserStatus.ACTIVE,
        mustChangePassword: true,
      });
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      ) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.EMAIL_ALREADY_REGISTERED,
          'An account with this email address already exists',
        );
      }
      throw error;
    }

    try {
      await this.assignmentModel.create({
        moderatorId: moderator._id,
        providerType: dto.providerType,
        providerId: dto.providerId,
        assignedBy: adminId,
      });
    } catch (error: unknown) {
      // Roll back the moderator if the assignment cannot be created.
      await this.userModel.deleteOne({ _id: moderator._id }).exec();
      throw error;
    }

    await this.audit.record({
      actorId: adminId,
      action: 'user.moderator_created',
      targetType: 'User',
      targetId: moderator._id.toString(),
      details: {
        providerType: dto.providerType,
        providerId: dto.providerId,
      },
    });

    return moderator;
  }
}

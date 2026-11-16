import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AuthService } from '../auth/auth.service.js';
import { ErrorCode } from '../common/constants/error-codes.js';
import { PAGE_SIZE } from '../common/constants/pagination.js';
import { Paginated } from '../common/dto/pagination.dto.js';
import {
  MODERATOR_ROLE_FOR_PROVIDER,
  ProviderType,
  UserRole,
  UserStatus,
} from '../common/constants/roles.js';
import { ProviderStatus } from '../flights/catalogue.constants.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import {
  AUDIT_SERVICE,
  type AuditService,
} from '../common/interfaces/audit.interface.js';
import {
  NOTIFICATION_SERVICE,
  type NotificationService,
} from '../common/interfaces/notification.interface.js';
import { BookingStatus } from '../common/interfaces/index.js';

import { Airline } from '../airlines/schemas/airline.schema.js';
import { Hotel } from '../hotels/schemas/hotel.schema.js';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema.js';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema.js';
import { ModeratorAssignment } from '../users/schemas/moderator-assignment.schema.js';
import { User, UserDocument } from '../users/schemas/user.schema.js';

import { CreateModeratorDto } from './dto/create-moderator.dto.js';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto.js';
import { ListBookingsQueryDto } from './dto/list-bookings-query.dto.js';

interface AdminBookingItem {
  id: string;
  type: 'flight' | 'hotel';
  reference: string | null;
  user: {
    id: string;
    name: string;
    email: string;
  };
  provider: {
    id: string;
    name: string;
    code?: string;
  };
  startDate: Date;
  endDate: Date;
  amount: number;
  currency: string;
  status: BookingStatus;
  createdAt: Date;
}

interface PopulatedUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
}

interface PopulatedProvider {
  _id: Types.ObjectId;
  name: string;
  code?: string;
}

interface FlightBookingRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId | PopulatedUser;
  airlineId: Types.ObjectId | PopulatedProvider;
  reference?: string;
  departureTime: Date;
  arrivalTime: Date;
  totalAmount: number;
  currency: string;
  status: BookingStatus;
  createdAt: Date;
}

interface HotelBookingRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId | PopulatedUser;
  hotelId: Types.ObjectId | PopulatedProvider;
  reference?: string;
  checkInDate: Date;
  checkOutDate: Date;
  totalAmount: number;
  currency: string;
  status: BookingStatus;
  createdAt: Date;
}

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

    @InjectModel(FlightBooking.name)
    private readonly flightBookingModel: Model<FlightBooking>,

    @InjectModel(HotelBooking.name)
    private readonly hotelBookingModel: Model<HotelBooking>,

    private readonly auth: AuthService,

    @Inject(AUDIT_SERVICE)
    private readonly audit: AuditService,

    @Inject(NOTIFICATION_SERVICE)
    private readonly notifications: NotificationService,
  ) {}

  /**
   * ACC-14: List all accounts with pagination, search and filters.
   */
  async listAccounts(
    query: ListAccountsQueryDto,
  ): Promise<Paginated<UserDocument>> {
    const { page, search, role, status } = query;

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

  /**
   * ACC-17: List flight and hotel bookings with combined pagination and filters.
   */
  async listBookings(
    query: ListBookingsQueryDto,
  ): Promise<Paginated<AdminBookingItem>> {
    const { page, type, status, from, to } = query;

    const skip = (page - 1) * PAGE_SIZE;
    const fetchLimit = skip + PAGE_SIZE;

    const dateFilter: { $gte?: Date; $lte?: Date } = {};

    if (from) {
      dateFilter.$gte = new Date(from);
    }

    if (to) {
      dateFilter.$lte = new Date(to);
    }

    const flightFilter: Record<string, unknown> = {};
    const hotelFilter: Record<string, unknown> = {};

    if (status) {
      flightFilter.status = status;
      hotelFilter.status = status;
    }

    if (from || to) {
      flightFilter.departureTime = dateFilter;
      hotelFilter.checkInDate = dateFilter;
    }

    const includeFlights = !type || type === 'flight';
    const includeHotels = !type || type === 'hotel';

    const [flightRowsResult, hotelRowsResult, flightCount, hotelCount] =
      await Promise.all([
        includeFlights
          ? this.flightBookingModel
              .find(flightFilter)
              .populate({
                path: 'userId',
                select: 'name email',
              })
              .populate({
                path: 'airlineId',
                select: 'name code',
              })
              .sort({ departureTime: -1 })
              .limit(fetchLimit)
              .lean()
              .exec()
          : Promise.resolve([]),

        includeHotels
          ? this.hotelBookingModel
              .find(hotelFilter)
              .populate({
                path: 'userId',
                select: 'name email',
              })
              .populate({
                path: 'hotelId',
                select: 'name',
              })
              .sort({ checkInDate: -1 })
              .limit(fetchLimit)
              .lean()
              .exec()
          : Promise.resolve([]),

        includeFlights
          ? this.flightBookingModel.countDocuments(flightFilter).exec()
          : Promise.resolve(0),

        includeHotels
          ? this.hotelBookingModel.countDocuments(hotelFilter).exec()
          : Promise.resolve(0),
      ]);

    const flightRows = flightRowsResult as unknown as FlightBookingRow[];

    const hotelRows = hotelRowsResult as unknown as HotelBookingRow[];

    const flightItems: AdminBookingItem[] = flightRows.map((booking) => {
      const user = booking.userId as PopulatedUser | null;
      const airline = booking.airlineId as PopulatedProvider | null;

      return {
        id: booking._id.toString(),
        type: 'flight',
        reference: booking.reference ?? null,
        user: user
          ? { id: user._id.toString(), name: user.name, email: user.email }
          : { id: '', name: 'Deleted user', email: '' },
        provider: airline
          ? {
              id: airline._id.toString(),
              name: airline.name,
              code: airline.code,
            }
          : { id: '', name: 'Unknown airline' },
        startDate: booking.departureTime,
        endDate: booking.arrivalTime,
        amount: booking.totalAmount,
        currency: booking.currency,
        status: booking.status,
        createdAt: booking.createdAt,
      };
    });

    const hotelItems: AdminBookingItem[] = hotelRows.map((booking) => {
      const user = booking.userId as PopulatedUser | null;
      const hotel = booking.hotelId as PopulatedProvider | null;

      return {
        id: booking._id.toString(),
        type: 'hotel',
        reference: booking.reference ?? null,
        user: user
          ? { id: user._id.toString(), name: user.name, email: user.email }
          : { id: '', name: 'Deleted user', email: '' },
        provider: hotel
          ? { id: hotel._id.toString(), name: hotel.name }
          : { id: '', name: 'Unknown hotel' },
        startDate: booking.checkInDate,
        endDate: booking.checkOutDate,
        amount: booking.totalAmount,
        currency: booking.currency,
        status: booking.status,
        createdAt: booking.createdAt,
      };
    });

    const allBookings = [...flightItems, ...hotelItems];

    allBookings.sort(
      (a, b) =>
        new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
    );

    const items = allBookings.slice(skip, skip + PAGE_SIZE);
    const totalItems = flightCount + hotelCount;

    return {
      items,
      meta: {
        page,
        pageSize: PAGE_SIZE,
        totalItems,
        totalPages: Math.ceil(totalItems / PAGE_SIZE),
      },
    };
  }

  /**
   * ACC-15: Suspend a moderator account.
   */
  async suspendModerator(
    adminId: string,
    moderatorId: string,
  ): Promise<UserDocument> {
    const moderator = await this.findModerator(moderatorId);

    if (moderator.status === UserStatus.DEACTIVATED) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCOUNT_DEACTIVATED,
        'This account has been deactivated',
      );
    }

    if (moderator.status === UserStatus.SUSPENDED) {
      return moderator;
    }

    moderator.status = UserStatus.SUSPENDED;
    await moderator.save();

    await this.auth.revokeAllSessionsForUser(moderatorId);

    await this.audit.record({
      actorId: adminId,
      action: 'user.suspended',
      targetType: 'User',
      targetId: moderatorId,
    });

    await this.notifications.notify({
      userId: moderatorId,
      type: 'account_suspended',
      title: 'Account suspended',
      message: 'Your moderator account has been suspended by an administrator.',
    });

    return moderator;
  }

  /**
   * ACC-15: Reactivate a suspended moderator account.
   */
  async reactivateModerator(
    adminId: string,
    moderatorId: string,
  ): Promise<UserDocument> {
    const moderator = await this.findModerator(moderatorId);

    if (moderator.status === UserStatus.DEACTIVATED) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCOUNT_DEACTIVATED,
        'A deactivated account cannot be reactivated through moderator suspension management',
      );
    }

    if (moderator.status === UserStatus.ACTIVE) {
      return moderator;
    }

    moderator.status = UserStatus.ACTIVE;
    await moderator.save();

    await this.audit.record({
      actorId: adminId,
      action: 'user.reactivated',
      targetType: 'User',
      targetId: moderatorId,
    });

    await this.notifications.notify({
      userId: moderatorId,
      type: 'account_reactivated',
      title: 'Account reactivated',
      message:
        'Your moderator account has been reactivated. You can now log in again.',
    });

    return moderator;
  }

  /**
   * ACC-15: Deactivate an airline or hotel.
   */
  async deactivateProvider(
    adminId: string,
    providerType: ProviderType,
    providerId: string,
  ): Promise<Airline | Hotel> {
    return this.updateProviderStatus(
      adminId,
      providerType,
      providerId,
      ProviderStatus.DEACTIVATED,
    );
  }

  /**
   * ACC-15: Reactivate an airline or hotel.
   */
  async reactivateProvider(
    adminId: string,
    providerType: ProviderType,
    providerId: string,
  ): Promise<Airline | Hotel> {
    return this.updateProviderStatus(
      adminId,
      providerType,
      providerId,
      ProviderStatus.ACTIVE,
    );
  }

  /**
   * Update provider status, notify its assigned moderator and affected
   * hotel customers, and record the action in the audit log.
   */
  private async updateProviderStatus(
    adminId: string,
    providerType: ProviderType,
    providerId: string,
    status: ProviderStatus,
  ): Promise<Airline | Hotel> {
    const provider =
      providerType === ProviderType.AIRLINE
        ? await this.airlineModel.findById(providerId).exec()
        : await this.hotelModel.findById(providerId).exec();

    if (!provider) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'The selected airline or hotel was not found',
      );
    }

    if (provider.status === status) {
      return provider;
    }

    provider.status = status;
    await provider.save();

    const isDeactivated = status === ProviderStatus.DEACTIVATED;

    await this.audit.record({
      actorId: adminId,
      action: isDeactivated ? 'provider.deactivated' : 'provider.reactivated',
      targetType: providerType === ProviderType.AIRLINE ? 'Airline' : 'Hotel',
      targetId: providerId,
      details: {
        providerType,
        status,
      },
    });

    const assignment = await this.assignmentModel
      .findOne({ providerType, providerId })
      .exec();

    if (assignment) {
      await this.notifications.notify({
        userId: assignment.moderatorId.toString(),
        type: isDeactivated ? 'provider_deactivated' : 'provider_reactivated',
        title: isDeactivated ? 'Provider deactivated' : 'Provider reactivated',
        message: isDeactivated
          ? 'The provider you manage has been deactivated by an administrator.'
          : 'The provider you manage has been reactivated by an administrator.',
        data: {
          providerType,
          providerId,
        },
      });
    }

    if (providerType === ProviderType.HOTEL) {
      const affectedUserIds = await this.hotelBookingModel.distinct('userId', {
        hotelId: providerId,
        status: {
          $in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT],
        },
        checkOutDate: { $gt: new Date() },
      });

      const customerIds = affectedUserIds.map((id) => String(id));

      if (customerIds.length > 0) {
        await this.notifications.notifyMany(customerIds, {
          type: isDeactivated ? 'provider_deactivated' : 'provider_reactivated',
          title: isDeactivated
            ? 'Hotel temporarily unavailable'
            : 'Hotel is available again',
          message: isDeactivated
            ? 'A hotel associated with your upcoming reservation has been deactivated. Your existing confirmed booking has not been cancelled.'
            : 'A hotel associated with your upcoming reservation has been reactivated.',
          data: {
            providerType,
            providerId,
          },
        });
      }
    }

    return provider;
  }

  /**
   * Find an account and ensure it belongs to a moderator.
   */
  private async findModerator(moderatorId: string): Promise<UserDocument> {
    const moderator = await this.userModel.findById(moderatorId).exec();

    if (
      !moderator ||
      ![UserRole.AIRLINE_MODERATOR, UserRole.HOTEL_MODERATOR].includes(
        moderator.role,
      )
    ) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Moderator account not found',
      );
    }

    return moderator;
  }

  /**
   * ACC-16: Suspend a registered user.
   */
  async suspendUser(adminId: string, userId: string): Promise<UserDocument> {
    const user = await this.findRegisteredUser(userId);

    if (user.status === UserStatus.DEACTIVATED) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCOUNT_DEACTIVATED,
        'This account has been deactivated',
      );
    }

    if (user.status === UserStatus.SUSPENDED) {
      return user;
    }

    user.status = UserStatus.SUSPENDED;
    await user.save();

    await this.auth.revokeAllSessionsForUser(userId);

    await this.audit.record({
      actorId: adminId,
      action: 'user.suspended',
      targetType: 'User',
      targetId: userId,
    });

    await this.notifications.notify({
      userId,
      type: 'account_suspended',
      title: 'Account suspended',
      message:
        'Your account has been suspended by an administrator. You can no longer log in.',
    });

    return user;
  }

  /**
   * ACC-16: Reactivate a suspended registered user.
   */
  async reactivateUser(adminId: string, userId: string): Promise<UserDocument> {
    const user = await this.findRegisteredUser(userId);

    if (user.status === UserStatus.DEACTIVATED) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCOUNT_DEACTIVATED,
        'A deactivated account cannot be reactivated through this operation',
      );
    }

    if (user.status === UserStatus.ACTIVE) {
      return user;
    }

    user.status = UserStatus.ACTIVE;
    await user.save();

    await this.audit.record({
      actorId: adminId,
      action: 'user.reactivated',
      targetType: 'User',
      targetId: userId,
    });

    await this.notifications.notify({
      userId,
      type: 'account_reactivated',
      title: 'Account reactivated',
      message: 'Your account has been reactivated. You can now log in again.',
    });

    return user;
  }

  /**
   * Ensure the target account is a registered user, not an admin or moderator.
   */
  private async findRegisteredUser(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();

    if (!user || user.role !== UserRole.USER) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Registered user account not found',
      );
    }

    return user;
  }
}

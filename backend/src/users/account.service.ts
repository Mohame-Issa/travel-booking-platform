import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuthService } from '../auth/auth.service.js';
import { SessionsService } from '../auth/sessions.service.js';
import { ErrorCode } from '../common/constants/error-codes.js';
import { UserRole, UserStatus } from '../common/constants/roles.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import {
  AUDIT_SERVICE,
  type AuditService,
  FLIGHT_UPCOMING_BOOKINGS_CHECKER,
  HOTEL_UPCOMING_BOOKINGS_CHECKER,
  type UpcomingConfirmedBookingsChecker,
} from '../common/interfaces/index.js';
import type {
  AdminResetPasswordDto,
  DeactivateAccountDto,
  UpdateProfileDto,
} from './dto/account.dto.js';
import { User, UserDocument } from './schemas/user.schema.js';

/** Profile, self-deactivation and admin password reset. */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Inject(FLIGHT_UPCOMING_BOOKINGS_CHECKER)
    private readonly flightBookings: UpcomingConfirmedBookingsChecker,
    @Inject(HOTEL_UPCOMING_BOOKINGS_CHECKER)
    private readonly hotelBookings: UpcomingConfirmedBookingsChecker,
  ) {}

  /** ACC-11: a user can only ever read their own profile. */
  async getProfile(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw notFound();
    return user;
  }

  /** ACC-09: saves only if every sent field passed validation (enforced by the DTO). */
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserDocument> {
    const update: Partial<Pick<User, 'name' | 'phone' | 'preferredCurrency'>> =
      {};
    if (dto.name !== undefined) update.name = dto.name;
    if (dto.phone !== undefined) update.phone = dto.phone;
    if (dto.preferredCurrency !== undefined)
      update.preferredCurrency = dto.preferredCurrency;

    if (Object.keys(update).length === 0) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Send at least one of: name, phone, preferredCurrency',
      );
    }

    const user = await this.userModel
      .findByIdAndUpdate(
        userId,
        { $set: update },
        { returnDocument: 'after', runValidators: true },
      )
      .exec();
    if (!user) throw notFound();
    return user;
  }

  /**
   * ACC-12: deactivate own account after confirming with the password.
   * Blocked while the user has an upcoming Confirmed flight or hotel booking.
   */
  async deactivate(userId: string, dto: DeactivateAccountDto): Promise<void> {
    const user = await this.userModel
      .findById(userId)
      .select('+passwordHash')
      .exec();
    if (!user) throw notFound();

    if (!(await this.auth.verifyPassword(dto.password, user.passwordHash))) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.INVALID_CURRENT_PASSWORD,
        'Password is incorrect',
        [{ field: 'password', messages: ['Password is incorrect'] }],
      );
    }

    const [hasFlights, hasHotels] = await Promise.all([
      this.flightBookings.hasUpcomingConfirmedBookings(userId),
      this.hotelBookings.hasUpcomingConfirmedBookings(userId),
    ]);
    if (hasFlights || hasHotels) {
      const kinds = [hasFlights && 'flight', hasHotels && 'hotel']
        .filter(Boolean)
        .join(' and ');
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.UPCOMING_BOOKINGS_EXIST,
        `You cannot deactivate your account while you have upcoming confirmed ${kinds} bookings. Cancel them or wait until your trips are finished.`,
      );
    }

    await this.userModel
      .updateOne(
        { _id: user._id, status: UserStatus.ACTIVE },
        {
          $set: { status: UserStatus.DEACTIVATED, deactivatedAt: new Date() },
        },
      )
      .exec();
    await this.sessions.revokeAllForUser(userId);
    this.logger.log(`User ${userId} deactivated their account`);
  }

  /**
   * ACC-07a: admin sets a temporary password for a user or moderator.
   * The account must choose a new password at its next login. Admin accounts
   * cannot be reset this way.
   */
  async adminResetPassword(
    adminId: string,
    targetId: string,
    dto: AdminResetPasswordDto,
  ): Promise<UserDocument> {
    const target = await this.userModel.findById(targetId).exec();
    if (!target) throw notFound();
    if (target.role === UserRole.ADMIN) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.CANNOT_RESET_ADMIN_PASSWORD,
        'Admin passwords cannot be reset through this endpoint',
      );
    }

    const updated = await this.userModel
      .findByIdAndUpdate(
        targetId,
        {
          $set: {
            passwordHash: await this.auth.hashPassword(dto.temporaryPassword),
            mustChangePassword: true,
            passwordChangedAt: new Date(),
            failedLoginAttempts: 0,
            lockUntil: null,
          },
        },
        { returnDocument: 'after' },
      )
      .exec();
    if (!updated) throw notFound();

    // Anyone still logged in with the old password is signed out.
    await this.sessions.revokeAllForUser(targetId);

    await this.audit.record({
      actorId: adminId,
      action: 'user.password_reset',
      targetType: 'User',
      targetId,
      details: { targetRole: updated.role, targetEmail: updated.email },
    });
    return updated;
  }
}

function notFound(): ApiException {
  return new ApiException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'User not found',
  );
}

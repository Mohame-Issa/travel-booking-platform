import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { ApiForbiddenResponse } from '@nestjs/swagger';
import { ErrorCode } from '../../common/constants/error-codes.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import type { AuthenticatedRequest } from '../../common/types/authenticated-user.js';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { User } from '../../users/schemas/user.schema.js';

/**
 * ACC-02 (bonus): "block booking until the email is verified". Runs after the
 * global AuthGuard, so req.user is set. Only accounts registered after ACC-02
 * have emailVerified = false; older and seeded accounts are not affected.
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  // Only the User model (global UsersModule), so every module can use this guard.
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.user) return true; // the global AuthGuard already decided
    const user = await this.users
      .findById(req.user.id, { emailVerified: 1 })
      .lean()
      .exec();
    // Accounts created before ACC-02 have no value and count as verified.
    if (user?.emailVerified === false)
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.EMAIL_NOT_VERIFIED,
        'Please verify your email address before booking. Check your inbox or request a new link.',
      );
    return true;
  }
}

/** Put on booking routes: the email must be verified first (ACC-02). */
export const RequireVerifiedEmail = () =>
  applyDecorators(
    UseGuards(EmailVerifiedGuard),
    ApiForbiddenResponse({
      type: ErrorResponseDto,
      description: 'EMAIL_NOT_VERIFIED (ACC-02)',
    }),
  );

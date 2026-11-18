import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ErrorCode } from '../../common/constants/error-codes.js';
import { UserStatus } from '../../common/constants/roles.js';
import {
  ALLOW_PENDING_PASSWORD_CHANGE_KEY,
  IS_PUBLIC_KEY,
} from '../../common/decorators/auth.decorators.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import type { AuthenticatedRequest } from '../../common/types/authenticated-user.js';
import { User } from '../../users/schemas/user.schema.js';
import { ACCESS_TOKEN_COOKIE } from '../auth.constants.js';
import { AuthService } from '../auth.service.js';
import { SessionsService } from '../sessions.service.js';

/**
 * Global guard: every route needs a logged-in user unless marked @Public().
 *
 * On each request it checks, in order:
 *   1. the access_token cookie is a valid, unexpired JWT        -> else 401 AUTH_REQUIRED
 *   2. its session still exists and was active in the last 30m -> else 401 SESSION_EXPIRED (ACC-06)
 *   3. the account is still active                              -> else 403 ACCOUNT_SUSPENDED / ACCOUNT_DEACTIVATED
 *   4. no pending forced password change                        -> else 403 PASSWORD_CHANGE_REQUIRED (ACC-07a)
 * Because 2 and 3 are read from the database every time, logout, suspension
 * and deactivation take effect immediately.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets))
      return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = (req.cookies as Record<string, string> | undefined)?.[
      ACCESS_TOKEN_COOKIE
    ];
    if (!token) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.AUTH_REQUIRED,
        'Please log in to continue',
      );
    }

    let payload;
    try {
      payload = await this.auth.verifyAccessToken(token);
    } catch {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.AUTH_REQUIRED,
        'Your login has expired. Refresh the session or log in again.',
      );
    }

    const session = await this.sessions.findActive(payload.sid);
    if (!session || String(session.userId) !== payload.sub) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.SESSION_EXPIRED,
        'Your session has expired. Please log in again.',
      );
    }

    const user = await this.userModel.findById(payload.sub).lean().exec();
    if (!user || user.status !== UserStatus.ACTIVE) {
      await this.sessions.revokeAllForUser(payload.sub);
      if (user?.status === UserStatus.SUSPENDED) {
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          ErrorCode.ACCOUNT_SUSPENDED,
          'Your account has been suspended',
        );
      }
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCOUNT_DEACTIVATED,
        'This account is no longer active',
      );
    }

    if (
      user.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(
        ALLOW_PENDING_PASSWORD_CHANGE_KEY,
        targets,
      )
    ) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.PASSWORD_CHANGE_REQUIRED,
        'You must change your password before continuing',
      );
    }

    await this.sessions.touch(session);

    req.user = {
      id: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role,
      sessionId: String(session._id),
      mustChangePassword: user.mustChangePassword,
    };
    return true;
  }
}

import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '../constants/error-codes.js';
import type { UserRole } from '../constants/roles.js';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../decorators/auth.decorators.js';
import { ApiException } from '../exceptions/api.exception.js';
import type { AuthenticatedRequest } from '../types/authenticated-user.js';

/**
 * Global guard (runs after AuthGuard). Enforces @Roles(...) on a route or
 * controller. Routes without @Roles are open to every logged-in user.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets))
      return true;

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      targets,
    );
    if (!roles || roles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (user && roles.includes(user.role)) return true;

    throw new ApiException(
      HttpStatus.FORBIDDEN,
      ErrorCode.INSUFFICIENT_ROLE,
      'You do not have permission to perform this action',
    );
  }
}

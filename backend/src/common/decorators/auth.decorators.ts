import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { UserRole } from '../constants/roles.js';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from '../types/authenticated-user.js';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';
export const ALLOW_PENDING_PASSWORD_CHANGE_KEY = 'allowPendingPasswordChange';

/**
 * Every route requires login by default (the AuthGuard is global).
 * Mark a route or controller @Public() to let guests call it, e.g. search.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Restricts a route to the listed roles. Without @Roles any logged-in user is allowed.
 *   @Roles(UserRole.ADMIN)
 *   @Roles(UserRole.AIRLINE_MODERATOR, UserRole.ADMIN)
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Lets an account whose password must be changed (ACC-07a, ACC-13) still call
 * this route. Only used by the auth endpoints; feature modules never need it.
 */
export const AllowPendingPasswordChange = () =>
  SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE_KEY, true);

/**
 * Injects the logged-in user:
 *   findMine(@CurrentUser() user: AuthenticatedUser)
 *   findMine(@CurrentUser('id') userId: string)
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return field ? req.user?.[field] : req.user;
  },
);

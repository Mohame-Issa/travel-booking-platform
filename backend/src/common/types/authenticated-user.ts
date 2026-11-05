import type { Request } from 'express';
import type { UserRole } from '../constants/roles.js';

/**
 * The logged-in user attached to every authenticated request by the global
 * AuthGuard. Read it in controllers with @CurrentUser().
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /** Id of the server-side session (used by logout). */
  sessionId: string;
  /** True after an admin reset (ACC-07a) or moderator creation (ACC-13). */
  mustChangePassword: boolean;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

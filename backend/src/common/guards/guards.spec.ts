import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '../../auth/guards/auth.guard.js';
import { ModeratorAssignmentsService } from '../../users/moderator-assignments.service.js';
import { ProviderType, UserRole, UserStatus } from '../constants/roles.js';
import {
  ALLOW_PENDING_PASSWORD_CHANGE_KEY,
  ROLES_KEY,
} from '../decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../types/authenticated-user.js';
import { paginateArray } from '../utils/paginate.js';
import { OWNERSHIP_KEY, OwnershipGuard } from './ownership.guard.js';
import { RolesGuard } from './roles.guard.js';

const OWNER_ID = '64b000000000000000000001';
const OTHER_ID = '64b000000000000000000002';
const DOC_ID = '64b0000000000000000000aa';
const HOTEL_ID = '64b0000000000000000000bb';

function user(role: UserRole, id = OWNER_ID): AuthenticatedUser {
  return {
    id,
    email: 'x@y.z',
    name: 'X',
    role,
    sessionId: 's',
    mustChangePassword: false,
  };
}

function ctx(req: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function reflectorWith(meta: Record<string, unknown>): Reflector {
  return {
    get: (key: string) => meta[key],
    getAllAndOverride: (key: string) => meta[key],
  } as unknown as Reflector;
}

async function errorCode(
  p: Promise<unknown> | (() => unknown),
): Promise<string | undefined> {
  try {
    await (typeof p === 'function' ? p() : p);
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

describe('RolesGuard', () => {
  it('allows any logged-in user when no @Roles is set', () => {
    const guard = new RolesGuard(reflectorWith({}));
    expect(guard.canActivate(ctx({ user: user(UserRole.USER) }))).toBe(true);
  });

  it('allows a listed role and rejects others with INSUFFICIENT_ROLE', async () => {
    const guard = new RolesGuard(
      reflectorWith({ [ROLES_KEY]: [UserRole.ADMIN] }),
    );
    expect(guard.canActivate(ctx({ user: user(UserRole.ADMIN) }))).toBe(true);
    expect(
      await errorCode(() =>
        guard.canActivate(ctx({ user: user(UserRole.USER) })),
      ),
    ).toBe('INSUFFICIENT_ROLE');
  });
});

describe('OwnershipGuard', () => {
  const connection = (doc: Record<string, unknown> | null) => ({
    model: () => ({
      findById: () => ({
        select: () => ({ lean: () => ({ exec: async () => doc }) }),
      }),
    }),
  });
  const guard = (
    doc: Record<string, unknown> | null,
    bypassRoles?: UserRole[],
  ) =>
    new OwnershipGuard(
      reflectorWith({ [OWNERSHIP_KEY]: { model: 'Itinerary', bypassRoles } }),
      connection(doc) as never,
    );

  it('allows the owner', async () => {
    const req = { user: user(UserRole.USER), params: { id: DOC_ID } };
    expect(await guard({ userId: OWNER_ID }).canActivate(ctx(req))).toBe(true);
  });

  it('rejects another user with NOT_RESOURCE_OWNER (403)', async () => {
    const req = { user: user(UserRole.USER, OTHER_ID), params: { id: DOC_ID } };
    expect(
      await errorCode(guard({ userId: OWNER_ID }).canActivate(ctx(req))),
    ).toBe('NOT_RESOURCE_OWNER');
  });

  it('returns NOT_FOUND for a missing document and INVALID_ID for a bad id', async () => {
    const u = user(UserRole.USER);
    expect(
      await errorCode(
        guard(null).canActivate(ctx({ user: u, params: { id: DOC_ID } })),
      ),
    ).toBe('NOT_FOUND');
    expect(
      await errorCode(
        guard(null).canActivate(ctx({ user: u, params: { id: 'abc' } })),
      ),
    ).toBe('INVALID_ID');
  });

  it('lets bypass roles (e.g. admin) through', async () => {
    const req = {
      user: user(UserRole.ADMIN, OTHER_ID),
      params: { id: DOC_ID },
    };
    expect(
      await guard({ userId: OWNER_ID }, [UserRole.ADMIN]).canActivate(ctx(req)),
    ).toBe(true);
  });
});

describe('ModeratorAssignmentsService.assertCanManage', () => {
  const service = (assigned: boolean) =>
    new ModeratorAssignmentsService({
      exists: async () => (assigned ? { _id: 'a' } : null),
    } as never);

  it('allows the assigned hotel moderator', async () => {
    expect(
      await errorCode(
        service(true).assertCanManage(
          user(UserRole.HOTEL_MODERATOR),
          ProviderType.HOTEL,
          HOTEL_ID,
        ),
      ),
    ).toBeUndefined();
  });

  it('rejects a hotel moderator of another hotel', async () => {
    expect(
      await errorCode(
        service(false).assertCanManage(
          user(UserRole.HOTEL_MODERATOR),
          ProviderType.HOTEL,
          HOTEL_ID,
        ),
      ),
    ).toBe('NOT_ASSIGNED_PROVIDER');
  });

  it('rejects an airline moderator on a hotel, and a regular user', async () => {
    expect(
      await errorCode(
        service(true).assertCanManage(
          user(UserRole.AIRLINE_MODERATOR),
          ProviderType.HOTEL,
          HOTEL_ID,
        ),
      ),
    ).toBe('NOT_ASSIGNED_PROVIDER');
    expect(
      await errorCode(
        service(true).assertCanManage(
          user(UserRole.USER),
          ProviderType.HOTEL,
          HOTEL_ID,
        ),
      ),
    ).toBe('NOT_ASSIGNED_PROVIDER');
  });

  it('always allows admins', async () => {
    expect(
      await errorCode(
        service(false).assertCanManage(
          user(UserRole.ADMIN),
          ProviderType.AIRLINE,
          HOTEL_ID,
        ),
      ),
    ).toBeUndefined();
  });
});

describe('AuthGuard forced password change (ACC-07a)', () => {
  const build = (meta: Record<string, unknown>) => {
    const session = {
      _id: 'sess',
      userId: OWNER_ID,
      lastActivityAt: new Date(),
    };
    const dbUser = {
      _id: OWNER_ID,
      email: 'x@y.z',
      name: 'X',
      role: UserRole.HOTEL_MODERATOR,
      status: UserStatus.ACTIVE,
      mustChangePassword: true,
    };
    return new AuthGuard(
      reflectorWith(meta),
      {
        verifyAccessToken: async () => ({
          sub: OWNER_ID,
          sid: 'sess',
          role: UserRole.HOTEL_MODERATOR,
        }),
      } as never,
      {
        findActive: async () => session,
        touch: async () => undefined,
        revokeAllForUser: async () => undefined,
      } as never,
      {
        findById: () => ({ lean: () => ({ exec: async () => dbUser }) }),
      } as never,
    );
  };
  const req = () =>
    ({ cookies: { access_token: 'tok' } }) as Record<string, unknown>;

  it('blocks normal routes with PASSWORD_CHANGE_REQUIRED', async () => {
    expect(await errorCode(build({}).canActivate(ctx(req())))).toBe(
      'PASSWORD_CHANGE_REQUIRED',
    );
  });

  it('allows routes marked @AllowPendingPasswordChange', async () => {
    const r = req();
    expect(
      await build({ [ALLOW_PENDING_PASSWORD_CHANGE_KEY]: true }).canActivate(
        ctx(r),
      ),
    ).toBe(true);
    expect((r.user as AuthenticatedUser).mustChangePassword).toBe(true);
  });
});

describe('paginateArray (GEN-05)', () => {
  it('uses page size 10', () => {
    const result = paginateArray(
      Array.from({ length: 23 }, (_, i) => i),
      3,
    );
    expect(result.items).toEqual([20, 21, 22]);
    expect(result.meta).toEqual({
      page: 3,
      pageSize: 10,
      totalItems: 23,
      totalPages: 3,
    });
  });
});

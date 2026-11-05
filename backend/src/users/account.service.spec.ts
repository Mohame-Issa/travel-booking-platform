import { UserRole, UserStatus } from '../common/constants/roles.js';
import { AccountService } from './account.service.js';

const USER_ID = '64b000000000000000000001';
const ADMIN_ID = '64b000000000000000000009';

async function errorCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

function setup(opts: {
  role?: UserRole;
  passwordOk?: boolean;
  upcomingFlights?: boolean;
  upcomingHotels?: boolean;
}) {
  const user = {
    _id: USER_ID,
    role: opts.role ?? UserRole.USER,
    status: UserStatus.ACTIVE,
    email: 'u@x.test',
    passwordHash: 'hash',
  };
  const updateOne = vi.fn(() => ({ exec: async () => ({}) }));
  const findByIdAndUpdate = vi.fn(() => ({ exec: async () => user }));
  const userModel = {
    findById: () => ({
      select: () => ({ exec: async () => user }),
      exec: async () => user,
    }),
    updateOne,
    findByIdAndUpdate,
  };
  const auth = {
    verifyPassword: async () => opts.passwordOk ?? true,
    hashPassword: async () => 'new-hash',
  };
  const sessions = { revokeAllForUser: vi.fn(async () => undefined) };
  const audit = { record: vi.fn(async () => undefined) };
  const checker = (v: boolean) => ({
    hasUpcomingConfirmedBookings: async () => v,
  });
  const service = new AccountService(
    userModel as never,
    auth as never,
    sessions as never,
    audit as never,
    checker(opts.upcomingFlights ?? false) as never,
    checker(opts.upcomingHotels ?? false) as never,
  );
  return { service, updateOne, findByIdAndUpdate, sessions, audit };
}

describe('AccountService.deactivate (ACC-12)', () => {
  it('deactivates and logs out everywhere when there are no upcoming bookings', async () => {
    const { service, updateOne, sessions } = setup({});
    await service.deactivate(USER_ID, { password: 'x' });
    expect(updateOne).toHaveBeenCalledOnce();
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(USER_ID);
  });

  it('is blocked by an upcoming Confirmed flight booking', async () => {
    const { service, updateOne } = setup({ upcomingFlights: true });
    expect(
      await errorCode(service.deactivate(USER_ID, { password: 'x' })),
    ).toBe('UPCOMING_BOOKINGS_EXIST');
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('is blocked by an upcoming Confirmed hotel booking', async () => {
    const { service } = setup({ upcomingHotels: true });
    expect(
      await errorCode(service.deactivate(USER_ID, { password: 'x' })),
    ).toBe('UPCOMING_BOOKINGS_EXIST');
  });

  it('rejects a wrong password', async () => {
    const { service, updateOne } = setup({ passwordOk: false });
    expect(
      await errorCode(service.deactivate(USER_ID, { password: 'x' })),
    ).toBe('INVALID_CURRENT_PASSWORD');
    expect(updateOne).not.toHaveBeenCalled();
  });
});

describe('AccountService.adminResetPassword (ACC-07a)', () => {
  it('forces a password change, revokes sessions and writes an audit entry', async () => {
    const { service, findByIdAndUpdate, sessions, audit } = setup({});
    await service.adminResetPassword(ADMIN_ID, USER_ID, {
      temporaryPassword: 'Temp1234',
    });
    const update = (findByIdAndUpdate.mock.calls[0] as unknown[])[1] as {
      $set: Record<string, unknown>;
    };
    expect(update.$set).toMatchObject({
      passwordHash: 'new-hash',
      mustChangePassword: true,
      failedLoginAttempts: 0,
      lockUntil: null,
    });
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(USER_ID);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ADMIN_ID,
        action: 'user.password_reset',
        targetId: USER_ID,
      }),
    );
  });

  it('refuses to reset an admin account', async () => {
    const { service, findByIdAndUpdate } = setup({ role: UserRole.ADMIN });
    expect(
      await errorCode(
        service.adminResetPassword(ADMIN_ID, USER_ID, {
          temporaryPassword: 'Temp1234',
        }),
      ),
    ).toBe('CANNOT_RESET_ADMIN_PASSWORD');
    expect(findByIdAndUpdate).not.toHaveBeenCalled();
  });
});

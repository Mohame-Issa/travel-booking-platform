
import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import bcrypt from 'bcryptjs';
import { Model } from 'mongoose';
import { ErrorCode } from '../common/constants/error-codes.js';
import { UserRole, UserStatus } from '../common/constants/roles.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { User, UserDocument } from '../users/schemas/user.schema.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  BCRYPT_ROUNDS,
  LOCKOUT_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
} from './auth.constants.js';
import type {
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
} from './dto/auth.dto.js';
import { SessionMeta, SessionsService } from './sessions.service.js';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  role: UserRole;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

/** Used to keep the response time similar when the email does not exist. */
const DUMMY_HASH = bcrypt.hashSync(
  'timing-equalizer-password-1',
  BCRYPT_ROUNDS,
);

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly sessions: SessionsService,
    private readonly jwt: JwtService,
  ) {}

  hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  /** ACC-01. Always creates a regular user; admins are seeded (ACC-18), moderators are created by admins (ACC-13). */
  async register(dto: RegisterDto): Promise<UserDocument> {
    if (await this.userModel.exists({ email: dto.email })) {
      throw emailTaken();
    }
    try {
      return await this.userModel.create({
        name: dto.name,
        email: dto.email,
        passwordHash: await this.hashPassword(dto.password),
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        termsAcceptedAt: new Date(),
      });
    } catch (e) {
      // Two registrations with the same email at the same moment: the unique index decides.
      if ((e as { code?: number }).code === 11000) throw emailTaken();
      throw e;
    }
  }

  /** ACC-04, ACC-05. */
  async login(
    dto: LoginDto,
    meta: SessionMeta,
  ): Promise<{ user: UserDocument; tokens: IssuedTokens }> {
    const user = await this.userModel
      .findOne({ email: dto.email })
      .select('+passwordHash')
      .exec();

    if (!user) {
      await bcrypt.compare(dto.password, DUMMY_HASH);
      throw invalidCredentials();
    }

    if (user.lockUntil && user.lockUntil.getTime() > Date.now()) {
      throw accountLocked(user.lockUntil);
    }

    const passwordOk = await this.verifyPassword(
      dto.password,
      user.passwordHash,
    );
    if (!passwordOk) {
      await this.recordFailedLogin(user);
      throw invalidCredentials();
    }

    // Status is only revealed after a correct password.
    if (user.status === UserStatus.SUSPENDED) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCOUNT_SUSPENDED,
        'Your account has been suspended',
      );
    }
    if (user.status === UserStatus.DEACTIVATED) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCOUNT_DEACTIVATED,
        'This account has been deactivated',
      );
    }

    await this.userModel
      .updateOne(
        { _id: user._id },
        {
          $set: {
            failedLoginAttempts: 0,
            lockUntil: null,
            lastLoginAt: new Date(),
          },
        },
      )
      .exec();

    const tokens = await this.startSession(user, meta);
    return { user, tokens };
  }

  /**
   * ACC-05: atomic increment, so parallel wrong guesses are all counted.
   * The request that reaches 5 sets the lock and resets the counter, so the
   * next window starts fresh after the 15 minutes.
   */
  private async recordFailedLogin(user: UserDocument): Promise<void> {
    const updated = await this.userModel
      .findOneAndUpdate(
        { _id: user._id },
        { $inc: { failedLoginAttempts: 1 } },
        { returnDocument: 'after', projection: { failedLoginAttempts: 1 } },
      )
      .exec();
    if (updated && updated.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
      const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
      await this.userModel
        .updateOne(
          {
            _id: user._id,
            failedLoginAttempts: { $gte: MAX_FAILED_LOGIN_ATTEMPTS },
          },
          { $set: { lockUntil, failedLoginAttempts: 0 } },
        )
        .exec();
      throw accountLocked(lockUntil);
    }
  }

  async startSession(
    user: UserDocument,
    meta: SessionMeta,
  ): Promise<IssuedTokens> {
    const { sessionId, refreshToken } = await this.sessions.create(
      String(user._id),
      meta,
    );
    return {
      accessToken: await this.signAccessToken(user, sessionId),
      refreshToken,
    };
  }

  /** ACC-19: issues a new access token and rotates the refresh token. */
  async refresh(
    refreshToken: string,
  ): Promise<{ user: UserDocument; tokens: IssuedTokens }> {
    const rotated = await this.sessions.rotate(refreshToken);
    if (!rotated) throw sessionExpired();

    const user = await this.userModel.findById(rotated.session.userId).exec();
    if (!user || user.status !== UserStatus.ACTIVE) {
      await this.sessions.revoke(String(rotated.session._id));
      throw sessionExpired();
    }
    return {
      user,
      tokens: {
        accessToken: await this.signAccessToken(
          user,
          String(rotated.session._id),
        ),
        refreshToken: rotated.refreshToken,
      },
    };
  }

  /**
   * ACC-06: revokes the server-side session. Works with either cookie, and
   * even with an expired access token, so logout always succeeds.
   */
  async logout(accessToken?: string, refreshToken?: string): Promise<void> {
    let sessionId: string | undefined = refreshToken?.split('.')[0];
    if (!sessionId && accessToken) {
      try {
        const payload = await this.jwt.verifyAsync<AccessTokenPayload>(
          accessToken,
          {
            ignoreExpiration: true,
          },
        );
        sessionId = payload.sid;
      } catch {
        sessionId = undefined;
      }
    }
    if (sessionId) await this.sessions.revoke(sessionId);
  }

  /** Revokes every active session for an account. Used by admin suspension. */
  async revokeAllSessionsForUser(userId: string): Promise<void> {
    await this.sessions.revokeAllForUser(userId);
  }

  /**
   * ACC-08 (and the forced change after ACC-07a / ACC-13).
   * Keeps the current session and logs the account out everywhere else.
   */
  async changePassword(
    userId: string,
    currentSessionId: string,
    dto: ChangePasswordDto,
  ): Promise<UserDocument> {
    const user = await this.userModel
      .findById(userId)
      .select('+passwordHash')
      .exec();
    if (!user) throw invalidCredentials();

    if (!(await this.verifyPassword(dto.currentPassword, user.passwordHash))) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.INVALID_CURRENT_PASSWORD,
        'Current password is incorrect',
        [
          {
            field: 'currentPassword',
            messages: ['Current password is incorrect'],
          },
        ],
      );
    }
    if (await this.verifyPassword(dto.newPassword, user.passwordHash)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.PASSWORD_UNCHANGED,
        'The new password must be different from the current one',
        [
          {
            field: 'newPassword',
            messages: [
              'The new password must be different from the current one',
            ],
          },
        ],
      );
    }

    user.passwordHash = await this.hashPassword(dto.newPassword);
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date();
    await user.save();
    await this.sessions.revokeAllForUser(userId, currentSessionId);
    return user;
  }

  verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token);
  }

  private signAccessToken(
    user: UserDocument,
    sessionId: string,
  ): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: String(user._id),
      sid: sessionId,
      role: user.role,
    };
    return this.jwt.signAsync(payload, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
  }
}

function invalidCredentials(): ApiException {
  return new ApiException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.INVALID_CREDENTIALS,
    'Invalid email or password',
  );
}

function emailTaken(): ApiException {
  return new ApiException(
    HttpStatus.CONFLICT,
    ErrorCode.EMAIL_ALREADY_REGISTERED,
    'This email is already registered',
    [{ field: 'email', messages: ['This email is already registered'] }],
  );
}

function sessionExpired(): ApiException {
  return new ApiException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.SESSION_EXPIRED,
    'Your session has expired. Please log in again.',
  );
}

function accountLocked(until: Date): ApiException {
  const minutes = Math.max(
    1,
    Math.ceil((until.getTime() - Date.now()) / 60000),
  );
  return new ApiException(
    HttpStatus.LOCKED,
    ErrorCode.ACCOUNT_LOCKED,
    `Too many failed login attempts. Your account is locked for ${minutes} more minute${minutes === 1 ? '' : 's'}.`,
  );
}

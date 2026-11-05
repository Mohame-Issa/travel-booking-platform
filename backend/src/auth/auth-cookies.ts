import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE_PATH,
  SESSION_IDLE_TIMEOUT_MS,
} from './auth.constants.js';

/**
 * ACC-19: tokens live only in httpOnly, Secure, SameSite cookies, never in
 * the response body, so browser JavaScript cannot read them.
 */
@Injectable()
export class AuthCookies {
  constructor(private readonly config: ConfigService) {}

  private base(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get<boolean>('COOKIE_SECURE') ?? true,
      sameSite:
        this.config.get<'lax' | 'strict' | 'none'>('COOKIE_SAMESITE') ?? 'lax',
    };
  }

  set(res: Response, accessToken: string, refreshToken: string): void {
    res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
      ...this.base(),
      path: '/',
      maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
    });
    res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      ...this.base(),
      path: REFRESH_TOKEN_COOKIE_PATH,
      maxAge: SESSION_IDLE_TIMEOUT_MS,
    });
  }

  clear(res: Response): void {
    res.clearCookie(ACCESS_TOKEN_COOKIE, { ...this.base(), path: '/' });
    res.clearCookie(REFRESH_TOKEN_COOKIE, {
      ...this.base(),
      path: REFRESH_TOKEN_COOKIE_PATH,
    });
  }
}

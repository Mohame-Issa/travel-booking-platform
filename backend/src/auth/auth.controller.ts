import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  AllowPendingPasswordChange,
  CurrentUser,
  Public,
} from '../common/decorators/auth.decorators.js';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import {
  toPublicUser,
  UserResponseDto,
} from '../users/dto/user-response.dto.js';
import { UsersService } from '../users/users.service.js';
import { AuthCookies } from './auth-cookies.js';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import {
  LoginDto,
  LoginResponseDto,
  MessageResponseDto,
  RegisterDto,
} from './dto/auth.dto.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly cookies: AuthCookies,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({
    summary: 'Register a new traveler account (ACC-01)',
    description:
      'Creates a regular user. Password: at least 8 characters with a letter and a digit. acceptTerms must be true. Does not log the user in.',
  })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED with field-level details',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'EMAIL_ALREADY_REGISTERED',
  })
  async register(@Body() dto: RegisterDto): Promise<UserResponseDto> {
    return toPublicUser(await this.auth.register(dto));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in (ACC-04, ACC-05, ACC-19)',
    description:
      'Sets httpOnly access_token and refresh_token cookies. 5 wrong passwords in a row lock the account for 15 minutes.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'INVALID_CREDENTIALS',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'ACCOUNT_SUSPENDED or ACCOUNT_DEACTIVATED',
  })
  @ApiResponse({
    status: 423,
    type: ErrorResponseDto,
    description: 'ACCOUNT_LOCKED',
  })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const { user, tokens } = await this.auth.login(dto, {
      userAgent: req.get('user-agent') ?? null,
      ip: req.ip ?? null,
    });
    this.cookies.set(res, tokens.accessToken, tokens.refreshToken);
    return {
      user: toPublicUser(user),
      mustChangePassword: user.mustChangePassword,
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get a new access token using the refresh cookie (ACC-19)',
    description:
      'Call this when a request returns 401 AUTH_REQUIRED after the 15-minute access token expires. Rotates the refresh token. Fails with SESSION_EXPIRED after 30 minutes of inactivity (ACC-06).',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'SESSION_EXPIRED',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const refreshToken = readCookie(req, REFRESH_TOKEN_COOKIE);
    if (!refreshToken) {
      this.cookies.clear(res);
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.SESSION_EXPIRED,
        'Please log in again',
      );
    }
    try {
      const { user, tokens } = await this.auth.refresh(refreshToken);
      this.cookies.set(res, tokens.accessToken, tokens.refreshToken);
      return {
        user: toPublicUser(user),
        mustChangePassword: user.mustChangePassword,
      };
    } catch (e) {
      this.cookies.clear(res);
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log out (ACC-06)',
    description:
      'Revokes the session on the server and clears both cookies. Always succeeds.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponseDto> {
    await this.auth.logout(
      readCookie(req, ACCESS_TOKEN_COOKIE),
      readCookie(req, REFRESH_TOKEN_COOKIE),
    );
    this.cookies.clear(res);
    return { message: 'Logged out' };
  }

  @Get('me')
  @AllowPendingPasswordChange()
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Current logged-in user (ACC-04, ACC-19)',
    description:
      'The frontend uses this to know who is logged in, since it cannot read the httpOnly cookies.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'AUTH_REQUIRED or SESSION_EXPIRED',
  })
  async me(
    @CurrentUser() current: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const user = await this.users.findById(current.id);
    if (!user) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.AUTH_REQUIRED,
        'Please log in to continue',
      );
    }
    return toPublicUser(user);
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthCookies } from '../auth/auth-cookies.js';
import { MessageResponseDto } from '../auth/dto/auth.dto.js';
import { UserRole } from '../common/constants/roles.js';
import { CurrentUser, Roles } from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { AccountService } from './account.service.js';
import { DeactivateAccountDto, UpdateProfileDto } from './dto/account.dto.js';
import { toPublicUser, UserResponseDto } from './dto/user-response.dto.js';

@ApiTags('Users')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'AUTH_REQUIRED or SESSION_EXPIRED',
})
@Controller('users')
export class UsersController {
  constructor(
    private readonly accounts: AccountService,
    private readonly cookies: AuthCookies,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: 'Get my profile (ACC-11)',
    description:
      'Always returns the logged-in account; there is no way to read another user’s profile here.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  async getMe(@CurrentUser('id') userId: string): Promise<UserResponseDto> {
    return toPublicUser(await this.accounts.getProfile(userId));
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Edit my profile (ACC-09)',
    description:
      'Edit name, phone number and preferred currency. Send only the fields to change; nothing is saved unless every sent field is valid.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED with field-level details',
  })
  async updateMe(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    return toPublicUser(await this.accounts.updateProfile(userId, dto));
  }

  @Delete('me')
  @Roles(UserRole.USER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deactivate my account (ACC-12)',
    description:
      'Registered users only. Confirm by sending your password. Blocked (409 UPCOMING_BOOKINGS_EXIST) while you have upcoming Confirmed flight or hotel bookings. Afterwards you are logged out everywhere and cannot log in again.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED or INVALID_CURRENT_PASSWORD',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'INSUFFICIENT_ROLE (admins and moderators)',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'UPCOMING_BOOKINGS_EXIST',
  })
  async deactivateMe(
    @CurrentUser('id') userId: string,
    @Body() dto: DeactivateAccountDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponseDto> {
    await this.accounts.deactivate(userId, dto);
    this.cookies.clear(res);
    return { message: 'Your account has been deactivated' };
  }
}

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserRole } from '../common/constants/roles.js';
import { CurrentUser, Roles } from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import { AccountService } from './account.service.js';
import {
  AdminResetPasswordDto,
  AdminResetPasswordResponseDto,
} from './dto/account.dto.js';
import { toPublicUser } from './dto/user-response.dto.js';

/**
 * Only the admin password reset lives here. The other /api/admin/accounts
 * endpoints belong to Omar Rashed's admin module.
 */
@ApiTags('Admin')
@ApiCookieAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly accounts: AccountService) {}

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Reset a user's or moderator's password (ACC-07a)",
    description:
      'Admin only. Sets a temporary password that follows the password rules, logs the account out everywhere, clears any login lockout and forces a new password at the next login. Recorded in the audit log.',
  })
  @ApiOkResponse({ type: AdminResetPasswordResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED or INVALID_ID',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'AUTH_REQUIRED or SESSION_EXPIRED',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'INSUFFICIENT_ROLE or CANNOT_RESET_ADMIN_PASSWORD',
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'NOT_FOUND' })
  async resetPassword(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AdminResetPasswordDto,
  ): Promise<AdminResetPasswordResponseDto> {
    const user = await this.accounts.adminResetPassword(adminId, id, dto);
    return {
      message:
        'Password reset. The account must set a new password at its next login.',
      user: toPublicUser(user),
    };
  }
}

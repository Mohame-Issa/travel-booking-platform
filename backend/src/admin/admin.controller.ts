import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { UserRole } from '../common/constants/roles.js';
import { CurrentUser, Roles } from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import {
  UserResponseDto,
  toPublicUser,
} from '../users/dto/user-response.dto.js';

import { CreateModeratorDto } from './dto/create-moderator.dto.js';
import { AdminService } from './admin.service.js';

/** ACC-13: an admin creates a moderator linked to exactly one airline or hotel. */
@ApiTags('Admin')
@ApiCookieAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/moderators')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a moderator and assign a provider' })
  @ApiCreatedResponse({
    description: 'Moderator created successfully',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED (e.g. password rules, invalid providerId)',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Authentication required',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Admin access required',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'The airline or hotel does not exist',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'EMAIL_ALREADY_REGISTERED',
  })
  async createModerator(
    @Body() dto: CreateModeratorDto,
    @CurrentUser() currentUser: { id: string },
  ): Promise<UserResponseDto> {
    const moderator = await this.adminService.createModerator(
      currentUser.id,
      dto,
    );

    return toPublicUser(moderator);
  }
}

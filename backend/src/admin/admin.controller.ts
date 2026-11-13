
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
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
  ApiPaginatedResponse,
  type Paginated,
} from '../common/dto/pagination.dto.js';
import {
  UserResponseDto,
  toPublicUser,
} from '../users/dto/user-response.dto.js';

import { CreateModeratorDto } from './dto/create-moderator.dto.js';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto.js';
import { AdminService } from './admin.service.js';

/** Admin account-management endpoints. */
@ApiTags('Admin')
@ApiCookieAuth()
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /** ACC-13: Create a moderator and assign a provider. */
  @Post('moderators')
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

  /** ACC-14: List accounts with pagination, search and filters. */
  @Get('accounts')
  @ApiOperation({
    summary: 'List accounts with pagination, search and filters',
  })
  @ApiPaginatedResponse(UserResponseDto)
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid pagination or filter query',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Authentication required',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Admin access required',
  })
  async listAccounts(
    @Query() query: ListAccountsQueryDto,
  ): Promise<Paginated<UserResponseDto>> {
    const result = await this.adminService.listAccounts(query);

    return {
      items: result.items.map(toPublicUser),
      meta: result.meta,
    };
  }
}

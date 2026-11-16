import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Patch,
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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ProviderType, UserRole } from '../common/constants/roles.js';
import { CurrentUser, Roles } from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
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
import { AdminBookingResponseDto } from './dto/admin-booking-response.dto.js';
import { ListBookingsQueryDto } from './dto/list-bookings-query.dto.js';
import { AdminService } from './admin.service.js';

/** Admin account and booking management endpoints. */
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

  /** ACC-17: read-only list of all flight and hotel bookings (admin only). */
  @Get('bookings')
  @ApiOperation({
    summary: 'List flight and hotel bookings with filters and pagination',
  })
  @ApiPaginatedResponse(AdminBookingResponseDto)
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid pagination or booking filter query',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Authentication required',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Admin access required',
  })
  async listBookings(
    @Query() query: ListBookingsQueryDto,
  ): Promise<Paginated<AdminBookingResponseDto>> {
    return this.adminService.listBookings(query);
  }

  /** ACC-15: Suspend a moderator account. */
  @Patch('moderators/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend a moderator account' })
  @ApiOkResponse({
    description: 'Moderator account suspended successfully',
    type: UserResponseDto,
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Authentication required',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Admin access required or account cannot be suspended',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Moderator account not found',
  })
  async suspendModerator(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() currentUser: { id: string },
  ): Promise<UserResponseDto> {
    const moderator = await this.adminService.suspendModerator(
      currentUser.id,
      id,
    );

    return toPublicUser(moderator);
  }

  /** ACC-15: Reactivate a suspended moderator account. */
  @Patch('moderators/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate a suspended moderator account' })
  @ApiOkResponse({
    description: 'Moderator account reactivated successfully',
    type: UserResponseDto,
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Authentication required',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Admin access required or account cannot be reactivated',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Moderator account not found',
  })
  async reactivateModerator(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() currentUser: { id: string },
  ): Promise<UserResponseDto> {
    const moderator = await this.adminService.reactivateModerator(
      currentUser.id,
      id,
    );

    return toPublicUser(moderator);
  }

  /** ACC-15: Deactivate an airline or hotel. */
  @Patch('providers/:type/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate an airline or hotel' })
  @ApiOkResponse({
    description: 'Provider deactivated successfully',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid provider type or ID',
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
    description: 'Provider not found',
  })
  async deactivateProvider(
    @Param('type', new ParseEnumPipe(ProviderType))
    type: ProviderType,
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() currentUser: { id: string },
  ): Promise<unknown> {
    return this.adminService.deactivateProvider(currentUser.id, type, id);
  }

  /** ACC-15: Reactivate an airline or hotel. */
  @Patch('providers/:type/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate an airline or hotel' })
  @ApiOkResponse({
    description: 'Provider reactivated successfully',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid provider type or ID',
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
    description: 'Provider not found',
  })
  async reactivateProvider(
    @Param('type', new ParseEnumPipe(ProviderType))
    type: ProviderType,
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() currentUser: { id: string },
  ): Promise<unknown> {
    return this.adminService.reactivateProvider(currentUser.id, type, id);
  }
}

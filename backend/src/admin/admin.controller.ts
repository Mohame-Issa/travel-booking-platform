
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { UserRole } from '../common/constants/roles.js';
import { CurrentUser, Roles } from '../common/decorators/auth.decorators.js';
import { UserResponseDto, toPublicUser } from '../users/dto/user-response.dto.js';

import { CreateModeratorDto } from './dto/create-moderator.dto.js';
import { AdminService } from './admin.service.js';

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
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
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

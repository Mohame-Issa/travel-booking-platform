import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserRole } from '../common/constants/roles.js';
import { CurrentUser, Roles } from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { CheckOwnership } from '../common/guards/ownership.guard.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import { ActivitiesService } from './activities.service.js';
import { AttachImageDto, UpdateActivityDto } from './dto/activity.dto.js';
import { ActivityDto } from './dto/day.dto.js';
import { Activity } from './schemas/activity.schema.js';

@ApiTags('Itineraries')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'AUTH_REQUIRED or SESSION_EXPIRED',
})
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'INSUFFICIENT_ROLE or NOT_RESOURCE_OWNER',
})
@ApiNotFoundResponse({
  type: ErrorResponseDto,
  description: 'Activity not found',
})
@Roles(UserRole.USER)
@Controller('activities/:id')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Patch()
  @CheckOwnership({ model: Activity.name })
  @ApiOperation({
    summary: 'Edit an activity (ITN-10)',
    description:
      'Send only what changes. time or cost may be null to remove them; cost and currency go together.',
  })
  @ApiOkResponse({ type: ActivityDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED',
  })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateActivityDto,
  ): Promise<ActivityDto> {
    return this.activities.update(id, dto);
  }

  @Delete()
  @CheckOwnership({ model: Activity.name })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an activity (ITN-10)',
    description:
      'Its images are released. The frontend asks for confirmation first (GEN-03).',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  remove(@Param('id', ParseObjectIdPipe) id: string): Promise<void> {
    return this.activities.remove(id);
  }

  @Post('images')
  @CheckOwnership({ model: Activity.name })
  @ApiOperation({
    summary: 'Attach an image to an activity (ITN-12, GEN-08)',
    description:
      'First upload the file with POST /api/uploads (JPG or PNG, max 5 MB), then send its id here. ' +
      'At most 5 images per activity.',
  })
  @ApiOkResponse({ type: ActivityDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'IMAGE_LIMIT_REACHED or ASSET_IN_USE',
  })
  attachImage(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: AttachImageDto,
  ): Promise<ActivityDto> {
    return this.activities.attachImage(id, userId, dto.imageId);
  }

  @Delete('images/:imageId')
  @CheckOwnership({ model: Activity.name })
  @ApiOperation({ summary: 'Remove an image from an activity (ITN-12)' })
  @ApiOkResponse({ type: ActivityDto })
  detachImage(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('imageId', ParseObjectIdPipe) imageId: string,
  ): Promise<ActivityDto> {
    return this.activities.detachImage(id, imageId);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
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
import { ApiPaginatedResponse } from '../common/dto/pagination.dto.js';
import type { Paginated } from '../common/dto/pagination.dto.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { CheckOwnership } from '../common/guards/ownership.guard.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import {
  CreateItineraryDto,
  ItineraryDetailDto,
  ItinerarySummaryDto,
  ListItinerariesQueryDto,
  UpdateItineraryDto,
} from './dto/itinerary.dto.js';
import { ItinerariesService } from './itineraries.service.js';
import { Itinerary } from './schemas/itinerary.schema.js';

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
@Roles(UserRole.USER)
@Controller('itineraries')
export class ItinerariesController {
  constructor(private readonly itineraries: ItinerariesService) {}

  @Post()
  @ApiOperation({
    summary: 'Create an itinerary (ITN-01)',
    description:
      'Title (max 100 characters), one or more country codes from the country list, and a start date. ' +
      'Private by default. Days are added with POST /api/itineraries/:id/days.',
  })
  @ApiCreatedResponse({ type: ItinerarySummaryDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED or UNKNOWN_COUNTRY',
  })
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateItineraryDto,
  ): Promise<ItinerarySummaryDto> {
    return this.itineraries.create(userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List my itineraries (ITN-03)',
    description:
      'Title, countries, start date, number of days and visibility; most recently updated first; 10 per page.',
  })
  @ApiPaginatedResponse(ItinerarySummaryDto)
  list(
    @CurrentUser('id') userId: string,
    @Query() query: ListItinerariesQueryDto,
  ): Promise<Paginated<ItinerarySummaryDto>> {
    return this.itineraries.listMine(userId, query.page);
  }

  @Get(':id')
  @CheckOwnership({ model: Itinerary.name })
  @ApiOperation({
    summary: 'Open one of my itineraries (ITN-03)',
    description:
      'Only the owner (ACC-11). Each day shows its number and its date (start date + day number - 1).',
  })
  @ApiOkResponse({ type: ItineraryDetailDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'INVALID_ID' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Itinerary not found',
  })
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ItineraryDetailDto> {
    return this.itineraries.getDetail(id);
  }

  @Patch(':id')
  @CheckOwnership({ model: Itinerary.name })
  @ApiOperation({
    summary: 'Edit an itinerary or change its visibility (ITN-01, ITN-20)',
    description:
      'Send only the fields to change. Changing the start date moves all day dates with it. ' +
      'visibility "public" shows it in shared search (read-only to others); "private" removes it immediately.',
  })
  @ApiOkResponse({ type: ItinerarySummaryDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED or UNKNOWN_COUNTRY',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Itinerary not found',
  })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateItineraryDto,
  ): Promise<ItinerarySummaryDto> {
    return this.itineraries.update(id, dto);
  }

  @Delete(':id')
  @CheckOwnership({ model: Itinerary.name })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an itinerary (ITN-01)',
    description:
      'Deletes it with all its days, activities, budget entries and transport costs. ' +
      'The frontend asks for confirmation first (GEN-03). Clones made by others are not affected.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Itinerary not found',
  })
  remove(@Param('id', ParseObjectIdPipe) id: string): Promise<void> {
    return this.itineraries.remove(id);
  }
}

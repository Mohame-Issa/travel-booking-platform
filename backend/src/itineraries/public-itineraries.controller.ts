import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserRole } from '../common/constants/roles.js';
import {
  CurrentUser,
  Public,
  Roles,
} from '../common/decorators/auth.decorators.js';
import {
  ApiPaginatedResponse,
  type Paginated,
} from '../common/dto/pagination.dto.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import { BudgetSummaryQueryDto } from './dto/budget.dto.js';
import { ItineraryDetailDto } from './dto/itinerary.dto.js';
import {
  PublicItineraryDetailDto,
  PublicItinerarySummaryDto,
  SearchPublicItinerariesDto,
} from './dto/public-itinerary.dto.js';
import { PublicItinerariesService } from './public-itineraries.service.js';

/** Shared itinerary search, read-only view and cloning (ITN-20, ITN-21). */
@ApiTags('Public itineraries')
@Controller('itineraries')
export class PublicItinerariesController {
  constructor(private readonly publicItineraries: PublicItinerariesService) {}

  // Declared before 'public/:id' so "search" is never read as an id.
  @Get('public/search')
  @Public()
  @ApiOperation({
    summary: 'Search public itineraries (ITN-21)',
    description:
      'Guests and users. Keyword q matches the title, a country or a city; filter by country, city and ' +
      'number of days (minDays/maxDays). Only public itineraries (ITN-20) that an admin has not hidden (GEN-10) ' +
      'and whose author is not deactivated (ACC-12). Newest updates first, 10 per page.',
  })
  @ApiPaginatedResponse(PublicItinerarySummaryDto)
  search(
    @Query() query: SearchPublicItinerariesDto,
  ): Promise<Paginated<PublicItinerarySummaryDto>> {
    return this.publicItineraries.search(query);
  }

  @Get('public/:id')
  @Public()
  @ApiOperation({
    summary: 'View a public itinerary, read-only (ITN-21)',
    description:
      'Author, days, activities and budget (in ?currency, default EGP). Private ones answer 404.',
  })
  @ApiOkResponse({ type: PublicItineraryDetailDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Not found, private or hidden',
  })
  getPublic(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: BudgetSummaryQueryDto,
  ): Promise<PublicItineraryDetailDto> {
    return this.publicItineraries.getPublic(id, query.currency);
  }

  @Post(':id/clone')
  @Roles(UserRole.USER)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Clone a public itinerary (ITN-21)',
    description:
      'Registered users. Creates an independent PRIVATE copy with all days, activities, budget entries and ' +
      'transport costs, crediting the original author (clonedFrom). Activity images are not copied, because ' +
      'an uploaded image belongs to one activity (GEN-08). Later changes or deletion of the original do not affect it.',
  })
  @ApiCreatedResponse({ type: ItineraryDetailDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'AUTH_REQUIRED',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'INSUFFICIENT_ROLE',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Not found, private or hidden',
  })
  clone(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryDetailDto> {
    return this.publicItineraries.clone(id, userId);
  }
}

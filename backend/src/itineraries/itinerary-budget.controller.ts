import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserRole } from '../common/constants/roles.js';
import { CurrentUser, Roles } from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { CheckOwnership } from '../common/guards/ownership.guard.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import { BudgetsService } from './budgets.service.js';
import {
  BudgetSummaryDto,
  BudgetSummaryQueryDto,
  CreateTransportCostDto,
  TransportCostDto,
} from './dto/budget.dto.js';
import {
  ItineraryFlightSearchDto,
  ItineraryHotelSearchDto,
} from './dto/itinerary-search.dto.js';
import { ItinerarySearchService } from './itinerary-search.service.js';
import { Itinerary } from './schemas/itinerary.schema.js';

/** Itinerary-level budget, transport and search routes. Owner only (ACC-11). */
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
  description: 'Itinerary or day not found',
})
@Roles(UserRole.USER)
@Controller('itineraries/:id')
export class ItineraryBudgetController {
  constructor(
    private readonly budgets: BudgetsService,
    private readonly search: ItinerarySearchService,
  ) {}

  @Post('transport-costs')
  @CheckOwnership({ model: Itinerary.name })
  @ApiOperation({
    summary: 'Add an intercity transport cost (ITN-16)',
    description:
      'Mode, from-city, to-city, amount (>= 0), currency, and the day of this itinerary it belongs to.',
  })
  @ApiCreatedResponse({ type: TransportCostDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED or UNKNOWN_CITY',
  })
  addTransport(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateTransportCostDto,
  ): Promise<TransportCostDto> {
    return this.budgets.createTransport(id, dto);
  }

  @Get('budget-summary')
  @CheckOwnership({ model: Itinerary.name })
  @ApiOperation({
    summary:
      'Budget totals, converted to one currency (ITN-14, ITN-18, ITN-09)',
    description:
      'Total by category and by day (budget entries + activity costs + intercity transport), and a subtotal per ' +
      "city group. Converted to ?currency, else the user's preferred currency, else EGP, with exchange rates " +
      'fetched once a day from FXRatesAPI and cached; if the API is down the last cached rates are used ' +
      '(ratesAreLatest = false). rateDate shows which day the rates are from.',
  })
  @ApiOkResponse({ type: BudgetSummaryDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED (unsupported currency)',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description: 'EXCHANGE_RATES_UNAVAILABLE (API down and nothing cached yet)',
  })
  summary(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
    @Query() query: BudgetSummaryQueryDto,
  ): Promise<BudgetSummaryDto> {
    return this.budgets.summary(id, userId, query.currency);
  }

  @Get('hotels')
  @CheckOwnership({ model: Itinerary.name })
  @ApiOperation({
    summary: "Hotels for one of the itinerary's city groups (ITN-25)",
    description:
      "Reuses hotel search (HTL-11). Check-in = date of the group's first day, check-out = the day after its last day. " +
      'Groups are numbered as in GET /api/itineraries/:id (1 = first).',
  })
  @ApiOkResponse({
    description: 'The group, its dates and the paginated hotel search results',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED',
  })
  hotels(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ItineraryHotelSearchDto,
  ) {
    return this.search.hotelsForGroup(id, query);
  }

  @Get('flights')
  @CheckOwnership({ model: Itinerary.name })
  @ApiOperation({
    summary: "Flights to the city of the itinerary's first day (ITN-26)",
    description:
      'Reuses flight search (FLT-11, FLT-12). One-way or round trip from a chosen origin airport. ' +
      "Outbound defaults to the start date, return to the last day's date.",
  })
  @ApiOkResponse({
    description: 'The arrival airport and the flight search results',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED',
  })
  flights(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ItineraryFlightSearchDto,
  ) {
    return this.search.flightsToStart(id, query);
  }
}

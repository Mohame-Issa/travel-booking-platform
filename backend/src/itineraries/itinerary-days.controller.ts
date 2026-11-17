import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
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
import { UserRole } from '../common/constants/roles.js';
import { Roles } from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { CheckOwnership } from '../common/guards/ownership.guard.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import { ActivitiesService } from './activities.service.js';
import { BudgetsService } from './budgets.service.js';
import { CreateActivityDto } from './dto/activity.dto.js';
import { BudgetEntryDto, CreateBudgetEntryDto } from './dto/budget.dto.js';
import {
  ActivityDto,
  AddDayDto,
  ReorderDayDto,
  UpdateDayDto,
} from './dto/day.dto.js';
import { ItineraryDetailDto } from './dto/itinerary.dto.js';
import { ItinerariesService } from './itineraries.service.js';
import { ItineraryDaysService } from './itinerary-days.service.js';
import { Itinerary } from './schemas/itinerary.schema.js';

/**
 * Days of an itinerary (ITN-05, ITN-07, ITN-08) and creating activities on a
 * day (ITN-10). Every route checks that the itinerary in the URL is mine
 * (ACC-11). Day changes return the whole itinerary, so the client sees the
 * renumbered days, their new dates and the city groups at once.
 */
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
@Controller('itineraries/:id/days')
export class ItineraryDaysController {
  constructor(
    private readonly days: ItineraryDaysService,
    private readonly itineraries: ItinerariesService,
    private readonly activities: ActivitiesService,
    private readonly budgets: BudgetsService,
  ) {}

  @Post()
  @CheckOwnership({ model: Itinerary.name })
  @ApiOperation({
    summary: 'Add a day (ITN-05)',
    description:
      'Adds a day at the end with a city from the city list and optional notes. ' +
      'Its number is the next one and its date is start date + (number - 1). At most 60 days.',
  })
  @ApiCreatedResponse({ type: ItineraryDetailDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED or UNKNOWN_CITY',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'ITINERARY_DAY_LIMIT (60 days)',
  })
  async add(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AddDayDto,
  ): Promise<ItineraryDetailDto> {
    await this.days.add(id, dto);
    return this.itineraries.getDetail(id);
  }

  // Declared before ':dayId' so "reorder" is never read as a day id.
  @Patch('reorder')
  @CheckOwnership({ model: Itinerary.name })
  @ApiOperation({
    summary: 'Move a day to a new position (ITN-08)',
    description:
      'Days are renumbered, and their dates and city groups recalculated. ' +
      'Activities and budget entries move with their day.',
  })
  @ApiOkResponse({ type: ItineraryDetailDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED (position out of range)',
  })
  async reorder(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ReorderDayDto,
  ): Promise<ItineraryDetailDto> {
    await this.days.reorder(id, dto);
    return this.itineraries.getDetail(id);
  }

  @Patch(':dayId')
  @CheckOwnership({ model: Itinerary.name })
  @ApiOperation({ summary: "Edit a day's city or notes (ITN-05)" })
  @ApiOkResponse({ type: ItineraryDetailDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED or UNKNOWN_CITY',
  })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Body() dto: UpdateDayDto,
  ): Promise<ItineraryDetailDto> {
    await this.days.update(id, dayId, dto);
    return this.itineraries.getDetail(id);
  }

  @Delete(':dayId')
  @CheckOwnership({ model: Itinerary.name })
  @ApiOperation({
    summary: 'Delete a day (ITN-07)',
    description:
      'Deletes the day with its activities, budget entries and transport costs. ' +
      'Later days are renumbered and their dates move back; budget totals follow. ' +
      'The frontend asks for confirmation first (GEN-03).',
  })
  @ApiOkResponse({
    type: ItineraryDetailDto,
    description: 'The itinerary after the deletion',
  })
  async remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
  ): Promise<ItineraryDetailDto> {
    await this.days.remove(id, dayId);
    return this.itineraries.getDetail(id);
  }

  @Post(':dayId/activities')
  @CheckOwnership({ model: Itinerary.name })
  @ApiOperation({
    summary: 'Add an activity to a day (ITN-10)',
    description:
      'Name, optional description, optional time (HH:mm) and optional cost with currency.',
  })
  @ApiCreatedResponse({ type: ActivityDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED',
  })
  addActivity(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Body() dto: CreateActivityDto,
  ): Promise<ActivityDto> {
    return this.activities.create(id, dayId, dto);
  }

  @Post(':dayId/budgets')
  @CheckOwnership({ model: Itinerary.name })
  @ApiOperation({
    summary: 'Add a budget entry to a day (ITN-14)',
    description:
      'Category food, accommodation, in_city_transport or activities; amount >= 0 in a supported currency.',
  })
  @ApiCreatedResponse({ type: BudgetEntryDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED',
  })
  addBudget(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Body() dto: CreateBudgetEntryDto,
  ): Promise<BudgetEntryDto> {
    return this.budgets.createEntry(id, dayId, dto);
  }
}

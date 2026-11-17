import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import {
  CurrentUser,
  ParseObjectIdPipe,
  Roles,
  UserRole,
} from './flight-bookings.imports.js';
import {
  ChangeFlightDto,
  ChangeQuoteQueryDto,
} from './dto/flight-change.dto.js';
import { FlightChangesService } from './flight-changes.service.js';

/** FLT-27 (bonus): change a Confirmed booking's date or flight (same route and cabin). */
@ApiTags('Flight bookings')
@ApiCookieAuth()
@ApiNotFoundResponse({ type: ErrorResponseDto })
@Controller('flight-bookings')
export class FlightChangesController {
  constructor(private readonly changes: FlightChangesService) {}

  @Get(':id/change-quote')
  @Roles(UserRole.USER)
  @ApiOperation({
    summary:
      'FLT-27 (bonus): fare difference of moving my Confirmed booking to another flight (reserves nothing)',
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  quote(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() q: ChangeQuoteQueryDto,
  ) {
    return this.changes.quote(userId, id, q.newFlightId);
  }

  @Post(':id/change')
  @Roles(UserRole.USER)
  @ApiOperation({
    summary:
      'FLT-27 (bonus): change flight. Cheaper/same fare: applied now, difference refunded. Dearer: seats held 10 min, pay the difference with the change id as bookingId',
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  change(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ChangeFlightDto,
  ) {
    return this.changes.request(userId, id, dto);
  }

  @Get(':id/changes')
  @Roles(UserRole.USER)
  @ApiOperation({ summary: 'FLT-27 (bonus): change history of my booking' })
  list(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.changes.list(userId, id);
  }
}

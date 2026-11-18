import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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
import { CurrentUser, Roles } from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/dto/pagination.dto.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import {
  CreateHotelBookingDto,
  HotelBookingQueryDto,
  HotelBookingResponseDto,
} from './dto/hotel-booking.dto.js';
import { HotelBookingsService } from './hotel-bookings.service.js';
import { RequireVerifiedEmail } from '../auth/guards/email-verified.guard.js';

@ApiTags('Hotel bookings')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'AUTH_REQUIRED or SESSION_EXPIRED',
})
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(private readonly bookings: HotelBookingsService) {}

  @Post()
  @Roles(UserRole.USER)
  @RequireVerifiedEmail() // ACC-02 (bonus)
  @ApiOperation({
    summary: 'Reserve one or more rooms of one hotel (HTL-16, HTL-18)',
    description:
      'Holds every selected room together for 10 minutes as one Pending Payment reservation, or nothing. ' +
      'Pay with POST /api/payments; the reservation is confirmed only after the verified payment (HTL-17).',
  })
  @ApiCreatedResponse({ type: HotelBookingResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED (dates, guests, occupancy)',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'INSUFFICIENT_ROLE',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Hotel or room not found',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'ROOM_NOT_AVAILABLE or PROVIDER_DEACTIVATED',
  })
  create(
    @Body() dto: CreateHotelBookingDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.bookings.create(dto, userId);
  }

  @Get()
  @ApiOperation({
    summary: 'My hotel reservations: upcoming, past or cancelled (HTL-20)',
  })
  @ApiPaginatedResponse(HotelBookingResponseDto)
  list(
    @CurrentUser('id') userId: string,
    @Query() query: HotelBookingQueryDto,
  ) {
    return this.bookings.listMine(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of my hotel reservations (HTL-20)' })
  @ApiOkResponse({ type: HotelBookingResponseDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: "NOT_FOUND (also for other users' reservations)",
  })
  get(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookings.getOne(id, user);
  }
}

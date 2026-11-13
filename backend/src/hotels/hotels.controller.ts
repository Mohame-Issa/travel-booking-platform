import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ProviderType, UserRole } from '../common/constants/roles.js';
import {
  CurrentUser,
  Public,
  Roles,
} from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ModeratorOfProvider } from '../common/guards/moderator-provider.guard.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import {
  CreateHotelDto,
  CreateRoomDto,
  DateRangeDto,
  EditAvailabilityDto,
  HotelPoliciesDto,
  OptionalStayQueryDto,
  ReservationsQueryDto,
  StayQueryDto,
  UpdateHotelDto,
  UpdateRoomDto,
} from './dto/hotel.dto.js';
import { HotelsService } from './hotels.service.js';

@ApiTags('Hotels')
@ApiBadRequestResponse({
  type: ErrorResponseDto,
  description: 'VALIDATION_FAILED or INVALID_ID',
})
@ApiNotFoundResponse({
  type: ErrorResponseDto,
  description: 'Hotel or room not found',
})
@Controller('hotels')
export class HotelsController {
  constructor(private readonly hotels: HotelsService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Create a hotel profile (HTL-01, admin)' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'INSUFFICIENT_ROLE',
  })
  create(@Body() dto: CreateHotelDto) {
    return this.hotels.create(dto);
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Hotel details (HTL-02)',
    description:
      'Profile, photos, amenities, check-in/out times, cancellation tiers and rating; free rooms when both dates are given.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'PROVIDER_DEACTIVATED (when dates are given)',
  })
  details(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() stay: OptionalStayQueryDto,
  ) {
    return this.hotels.details(id, stay);
  }

  @Patch(':id')
  @ApiManage('Edit the hotel profile and photos (HTL-01, GEN-08)')
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateHotelDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.hotels.update(id, dto, actorId);
  }

  @Public()
  @Get(':id/rooms/available')
  @ApiOperation({
    summary: 'Rooms free for the whole stay, with total price (HTL-15)',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'PROVIDER_DEACTIVATED',
  })
  available(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() stay: StayQueryDto,
  ) {
    return this.hotels.freeRooms(id, stay.checkInDate, stay.checkOutDate);
  }

  @Post(':id/rooms')
  @ApiManage('Add a room (HTL-03)')
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'DUPLICATE_KEY (room number already used in this hotel)',
  })
  addRoom(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateRoomDto,
  ) {
    return this.hotels.addRoom(id, dto);
  }

  @Patch(':id/rooms/:roomId')
  @ApiManage('Edit beds, occupancy, price or status of a room (HTL-05, HTL-06)')
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'RESERVATION_CONFLICT (deactivating a reserved room)',
  })
  updateRoom(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.hotels.updateRoom(id, roomId, dto);
  }

  @Delete(':id/rooms/:roomId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiManage('Delete a never-reserved room (HTL-06)')
  @ApiNoContentResponse()
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'ROOM_HAS_RESERVATIONS',
  })
  deleteRoom(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
  ) {
    return this.hotels.deleteRoom(id, roomId);
  }

  @Post(':id/rooms/:roomId/availability')
  @ApiManage('Add a bookable date range (HTL-04)')
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'AVAILABILITY_OVERLAP',
  })
  addAvailability(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: DateRangeDto,
  ) {
    return this.hotels.addAvailability(id, roomId, dto);
  }

  @Patch(':id/rooms/:roomId/availability')
  @ApiManage('Block, unblock or remove bookable dates (HTL-05, HTL-06)')
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'RESERVATION_CONFLICT',
  })
  editAvailability(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: EditAvailabilityDto,
  ) {
    return this.hotels.editAvailability(id, roomId, dto);
  }

  @Get(':id/availability')
  @ApiManage(
    'Room status calendar: Available, Booked (with reference) or Blocked (HTL-08)',
  )
  calendar(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() dto: DateRangeDto,
  ) {
    return this.hotels.calendar(id, dto);
  }

  @Put(':id/policies')
  @ApiManage('Set check-in/out times and cancellation tiers (HTL-09, HTL-10)')
  setPolicies(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: HotelPoliciesDto,
  ) {
    return this.hotels.setPolicies(id, dto);
  }

  @Get(':id/reservations')
  @ApiManage("This hotel's reservations: guest, dates, status (HTL-22)")
  reservations(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ReservationsQueryDto,
  ) {
    return this.hotels.reservations(id, query);
  }
}

/** Hotel moderator of THIS hotel (or admin), with the shared auth docs. */
function ApiManage(summary: string) {
  return applyDecorators(
    Roles(UserRole.HOTEL_MODERATOR, UserRole.ADMIN),
    ModeratorOfProvider(ProviderType.HOTEL),
    ApiCookieAuth(),
    ApiOperation({ summary }),
    ApiUnauthorizedResponse({ type: ErrorResponseDto }),
    ApiForbiddenResponse({
      type: ErrorResponseDto,
      description: 'INSUFFICIENT_ROLE or NOT_ASSIGNED_PROVIDER',
    }),
  );
}

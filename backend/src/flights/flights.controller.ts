import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
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
  ApiNotImplementedResponse,
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
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import {
  CabinResponseDto,
  CancelFlightDto,
  CreateCabinDto,
  CreateFlightDto,
  FlightDetailsResponseDto,
  FlightResponseDto,
  FlightSearchResponseDto,
  SearchFlightsQueryDto,
  UpdateCabinDto,
  UpdateFlightDto,
} from './dto/flight.dto.js';
import { FlightsService } from './flights.service.js';

@ApiTags('Flights')
@ApiCookieAuth()
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@Controller('flights')
export class FlightsController {
  constructor(private readonly flights: FlightsService) {}
  @Post()
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiCreatedResponse({ type: FlightResponseDto })
  @ApiOperation({ summary: 'Create an assigned-airline flight (FLT-03)' })
  create(@Body() dto: CreateFlightDto, @CurrentUser() user: AuthenticatedUser) {
    return this.flights.create(dto, user);
  }
  @Get('search')
  @Public()
  @ApiOkResponse({ type: FlightSearchResponseDto })
  @ApiOperation({
    summary: 'Search flights (FLT-11, FLT-12, FLT-15)',
    description:
      'Each leg has its own page of 10 flight/cabin options. price is the cabin fare; totalPrice is the party quote including infants. Local times are accompanied by origin/destination IANA zones. Selected round-trip chronology is validated by the booking owner.',
  })
  search(@Query() query: SearchFlightsQueryDto) {
    return this.flights.search(query);
  }
  @Get(':id')
  @Public()
  @ApiOkResponse({ type: FlightDetailsResponseDto })
  @ApiOperation({
    summary: 'Read flight details, cabins and policies (FLT-17, GEN-06)',
  })
  details(@Param('id', ParseObjectIdPipe) id: string) {
    return this.flights.details(id);
  }
  @Patch(':id')
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiOkResponse({ type: FlightResponseDto })
  @ApiNotImplementedResponse({
    type: ErrorResponseDto,
    description:
      'Legacy airport edit requires the booking-history adapter when bookingCount is absent.',
  })
  @ApiOperation({
    summary: 'Edit a Scheduled flight (FLT-05)',
    description:
      'Airports cannot change after any booking. Legacy flights without a lifetime bookingCount require verified all-state booking history; an unavailable adapter returns 501. Changed times create a durable flight.updated event. Existing bookings retain agreed prices.',
  })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateFlightDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.flights.update(id, dto, user);
  }
  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiOkResponse({ type: FlightResponseDto })
  @ApiOperation({
    summary: 'Confirm flight cancellation (FLT-06, GEN-03)',
    description:
      "Stores flight.cancelled transactionally. Omar's consumer owns booking cancellation, 100% refunds, inventory release and notifications. Repeating this operation is idempotent.",
  })
  cancel(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() _dto: CancelFlightDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.flights.cancel(id, user);
  }
  @Post(':id/cabins')
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiCreatedResponse({ type: CabinResponseDto })
  @ApiOperation({ summary: 'Add a cabin category (FLT-04)' })
  createCabin(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateCabinDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.flights.createCabin(id, dto, user);
  }
  @Patch(':id/cabins/:cabinId')
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiOkResponse({ type: CabinResponseDto })
  @ApiOperation({
    summary: 'Edit cabin capacity, price and baggage (FLT-04, FLT-05)',
    description:
      'Capacity cannot undercut booked plus held seats. Inventory counters cannot be supplied in this request.',
  })
  updateCabin(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('cabinId', ParseObjectIdPipe) cabinId: string,
    @Body() dto: UpdateCabinDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.flights.updateCabin(id, cabinId, dto, user);
  }
}

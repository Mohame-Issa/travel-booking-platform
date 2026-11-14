import { Controller, Get, Param, Query, StreamableFile } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  ParseObjectIdPipe,
  Roles,
  UserRole,
  type AuthenticatedUser,
} from './flight-bookings.imports.js';
import { FlightBookingsQueryDto } from './dto/flight-booking.dto.js';
import { FlightBookingsService } from './flight-bookings.service.js';

/** Separate controller so it never clashes with Yassin's FlightsController. */
@ApiTags('Flight bookings (airline moderator)')
@ApiCookieAuth()
@Controller('flights')
export class FlightPassengersController {
  constructor(private readonly service: FlightBookingsService) {}

  @Get(':id/bookings')
  @Roles(UserRole.AIRLINE_MODERATOR, UserRole.ADMIN)
  @ApiOperation({
    summary: 'FLT-29: bookings of a flight + seats remaining per cabin',
  })
  bookings(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() q: FlightBookingsQueryDto,
  ) {
    return this.service.bookingsForFlight(user, id, q);
  }

  @Get(':id/passengers/export')
  @Roles(UserRole.AIRLINE_MODERATOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'FLT-29: passenger list as CSV' })
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const csv = await this.service.passengersCsv(user, id);
    return new StreamableFile(Buffer.from(csv, 'utf-8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="passengers-${id}.csv"`,
    });
  }
}

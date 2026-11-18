import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  ParseObjectIdPipe,
  Roles,
  UserRole,
  type AuthenticatedUser,
} from './flight-bookings.imports.js';
import { RequireVerifiedEmail } from '../auth/guards/email-verified.guard.js';
import {
  BookingRequestDto,
  CancelBookingDto,
  ListMyBookingsQueryDto,
} from './dto/flight-booking.dto.js';
import { ChangeSeatsDto } from './dto/seat.dto.js';
import { FlightBookingsService } from './flight-bookings.service.js';

@ApiTags('Flight bookings')
@ApiCookieAuth()
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(private readonly service: FlightBookingsService) {}

  @Post()
  @HttpCode(200)
  @Roles(UserRole.USER)
  @ApiOperation({
    summary:
      'FLT-19/FLT-21: validate passengers + baggage and show the booking summary (reserves nothing)',
  })
  summary(@Body() dto: BookingRequestDto) {
    return this.service.summary(dto);
  }

  @Post('hold')
  @Roles(UserRole.USER)
  @RequireVerifiedEmail() // ACC-02 (bonus)
  @ApiOperation({
    summary:
      'FLT-22: atomically hold the seats for 10 minutes (creates a Pending Payment booking)',
  })
  hold(@CurrentUser('id') userId: string, @Body() dto: BookingRequestDto) {
    return this.service.hold(userId, dto);
  }

  @Get()
  @Roles(UserRole.USER)
  @ApiOperation({
    summary: 'FLT-25: my bookings; ?group=upcoming|past|cancelled',
  })
  list(@CurrentUser('id') userId: string, @Query() q: ListMyBookingsQueryDto) {
    return this.service.list(userId, q);
  }

  @Get(':id')
  @Roles(UserRole.USER, UserRole.ADMIN)
  @ApiOperation({ summary: 'FLT-25: booking details' })
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.service.getOne(user, id);
  }

  @Get(':id/e-ticket')
  @Roles(UserRole.USER)
  @ApiOperation({ summary: 'FLT-23: download the e-ticket (PDF)' })
  async eTicket(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const { pdf, filename } = await this.service.eTicket(userId, id);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get(':id/refund-preview')
  @Roles(UserRole.USER)
  @ApiOperation({
    summary: 'FLT-26: refund shown BEFORE the user confirms the cancellation',
  })
  preview(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.service.refundPreview(userId, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(UserRole.USER)
  @ApiOperation({
    summary:
      'FLT-26: cancel my Confirmed booking before departure (body {"confirm": true})',
  })
  cancel(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() _dto: CancelBookingDto,
  ) {
    return this.service.cancel(userId, id);
  }

  @Patch(':id/seats')
  @Roles(UserRole.USER)
  @ApiOperation({
    summary:
      'FLT-28 (bonus): move passengers of my Pending Payment or Confirmed booking to other free seats',
  })
  changeSeats(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ChangeSeatsDto,
  ) {
    return this.service.changeSeats(userId, id, dto);
  }
}

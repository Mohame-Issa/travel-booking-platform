import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, ParseObjectIdPipe, Roles, UserRole } from './hotel-cancellation.imports.js';
import { CancelBookingDto } from '../../flight-bookings/dto/flight-booking.dto.js';
import { HotelBookingCancellationService } from './hotel-booking-cancellation.service.js';

/** Separate controller so it never clashes with Mohamed Hashad's hotel bookings controller. */
@ApiTags('Hotel bookings')
@ApiCookieAuth()
@Controller('hotel-bookings')
export class HotelBookingCancellationController {
  constructor(private readonly service: HotelBookingCancellationService) {}

  @Get(':id/refund-preview') @Roles(UserRole.USER)
  @ApiOperation({ summary: 'HTL-21: refund shown BEFORE the user confirms the cancellation' })
  preview(@CurrentUser('id') userId: string, @Param('id', ParseObjectIdPipe) id: string) {
    return this.service.refundPreview(userId, id);
  }

  @Post(':id/cancel') @HttpCode(200) @Roles(UserRole.USER)
  @ApiOperation({ summary: 'HTL-21: cancel my whole Confirmed reservation before check-in (body {"confirm": true})' })
  cancel(@CurrentUser('id') userId: string, @Param('id', ParseObjectIdPipe) id: string, @Body() _dto: CancelBookingDto) {
    return this.service.cancel(userId, id);
  }
}
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ParseObjectIdPipe } from './flight-bookings.imports.js';
import { SeatMapQueryDto, SeatMapDto } from './dto/seat.dto.js';
import { SeatsService } from './seats.service.js';
import { ApiOkResponse } from '@nestjs/swagger';

@ApiTags('Flight bookings')
@Controller('flights')
export class SeatsController {
  constructor(private readonly seats: SeatsService) {}

  @Get(':id/seats')
  @Public()
  @ApiOperation({
    summary:
      'FLT-28 (bonus): seat map of one cabin (rows of 6, A-F) with free and taken seats',
  })
  @ApiOkResponse({ type: SeatMapDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  seatMap(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() q: SeatMapQueryDto,
  ) {
    return this.seats.seatMap(id, q.cabinClass);
  }
}

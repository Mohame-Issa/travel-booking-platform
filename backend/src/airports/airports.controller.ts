import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/dto/pagination.dto.js';
import { AirportsService } from './airports.service.js';
import { AirportResponseDto, AirportsQueryDto } from './dto/airport.dto.js';

@ApiTags('Airports')
@Controller('airports')
export class AirportsController {
  constructor(private readonly airports: AirportsService) {}
  @Get()
  @Public()
  @ApiPaginatedResponse(AirportResponseDto)
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiOperation({ summary: 'Read the official airport list (FLT-02, GEN-12)' })
  list(@Query() query: AirportsQueryDto) {
    return this.airports.list(query);
  }
}

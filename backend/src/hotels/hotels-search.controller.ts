import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/dto/pagination.dto.js';
import {
  HotelSearchItemDto,
  SearchHotelsQueryDto,
} from './dto/search-hotels.dto.js';
import { HotelsSearchService } from './hotels-search.service.js';

@ApiTags('Hotel search')
@Controller('hotels')
export class HotelsSearchController {
  constructor(private readonly hotels: HotelsSearchService) {}
  @Get('search')
  @Public()
  @ApiPaginatedResponse(HotelSearchItemDto)
  @ApiOperation({
    summary: 'Search hotels (HTL-11, HTL-12)',
    description:
      'UTC date-only [check-in, check-out) ranges; all nights must be available. Blocks, confirmed occupancy and live holds exclude rooms. Price is the cheapest room capable of participating in the requested room count and occupancy. Search is advisory; the booking owner rechecks inventory atomically.',
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  search(@Query() query: SearchHotelsQueryDto) {
    return this.hotels.search(query);
  }
}

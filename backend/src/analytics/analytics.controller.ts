import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '../common/constants/roles.js';
import { Roles } from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { AnalyticsService } from './analytics.service.js';
import {
  AnalyticsQueryDto,
  AnalyticsResponseDto,
} from './dto/analytics.dto.js';

@ApiTags('Admin')
@ApiCookieAuth()
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary:
      'BON-01 (bonus): bookings and revenue per airline and hotel over a period (default: last 30 days)',
  })
  @ApiOkResponse({ type: AnalyticsResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'INVALID_DATE_RANGE or VALIDATION_FAILED',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'INSUFFICIENT_ROLE (admins only)',
  })
  dashboard(@Query() q: AnalyticsQueryDto): Promise<AnalyticsResponseDto> {
    return this.analytics.dashboard(q);
  }
}

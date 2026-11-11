import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
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
import {
  AcceptPoliciesDto,
  BookingPoliciesResponseDto,
  BookingRefParamsDto,
} from './dto/policies.dto.js';
import { PoliciesService } from './policies.service.js';

@ApiTags('Payments')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'AUTH_REQUIRED or SESSION_EXPIRED',
})
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'NOT_RESOURCE_OWNER or INSUFFICIENT_ROLE',
})
@ApiNotFoundResponse({
  type: ErrorResponseDto,
  description: 'Booking not found',
})
@Roles(UserRole.USER)
@Controller('bookings/:type/:id')
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Get('policies')
  @ApiOperation({
    summary: 'Show provider policies before payment (PAY-02)',
    description:
      'Flight: airline cancellation tiers (FLT-09) and baggage policy (FLT-04, FLT-08). ' +
      'Hotel: cancellation tiers (HTL-10) and check-in/check-out times (HTL-09). ' +
      'Only the booking owner. After acceptance, returns the accepted snapshot.',
  })
  @ApiOkResponse({ type: BookingPoliciesResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'type must be flight or hotel; invalid id',
  })
  getPolicies(
    @CurrentUser('id') userId: string,
    @Param() params: BookingRefParamsDto,
  ): Promise<BookingPoliciesResponseDto> {
    return this.policies.getPolicies(userId, params.type, params.id);
  }

  @Post('accept-policies')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept provider policies (PAY-02)',
    description:
      'Send { "accepted": true } (the checkbox). Stores the acceptance with a timestamp and a copy of the policies. ' +
      'Required before POST /api/payments. Only for Pending Payment bookings inside their hold. ' +
      'Calling it again returns the original acceptance.',
  })
  @ApiOkResponse({ type: BookingPoliciesResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED (accepted must be true)',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'BOOKING_NOT_PAYABLE or HOLD_EXPIRED',
  })
  acceptPolicies(
    @CurrentUser('id') userId: string,
    @Param() params: BookingRefParamsDto,
    @Body() _dto: AcceptPoliciesDto,
  ): Promise<BookingPoliciesResponseDto> {
    return this.policies.acceptPolicies(userId, params.type, params.id);
  }
}

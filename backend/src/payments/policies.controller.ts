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
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '../common/constants/roles.js';
import { CurrentUser, Roles } from '../common/decorators/auth.decorators.js';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiErrors } from './api-errors.decorator.js';
import {
  AcceptPoliciesDto,
  BookingPoliciesResponseDto,
  BookingRefParamsDto,
} from './dto/policies.dto.js';
import { PoliciesService } from './policies.service.js';

@ApiTags('Payments')
@ApiCookieAuth()
@ApiErrors(
  HttpStatus.UNAUTHORIZED,
  ErrorCode.AUTH_REQUIRED,
  ErrorCode.SESSION_EXPIRED,
)
@ApiErrors(
  HttpStatus.FORBIDDEN,
  ErrorCode.NOT_RESOURCE_OWNER,
  ErrorCode.INSUFFICIENT_ROLE,
)
@ApiErrors(HttpStatus.NOT_FOUND, {
  code: ErrorCode.NOT_FOUND,
  message: 'Booking not found',
})
@ApiErrors(HttpStatus.NOT_IMPLEMENTED, ErrorCode.NOT_IMPLEMENTED)
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
  @ApiErrors(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_FAILED,
    ErrorCode.INVALID_ID,
  )
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
  @ApiErrors(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED)
  @ApiErrors(
    HttpStatus.CONFLICT,
    ErrorCode.BOOKING_NOT_PAYABLE,
    ErrorCode.HOLD_EXPIRED,
  )
  acceptPolicies(
    @CurrentUser('id') userId: string,
    @Param() params: BookingRefParamsDto,
    @Body() _dto: AcceptPoliciesDto,
  ): Promise<BookingPoliciesResponseDto> {
    return this.policies.acceptPolicies(userId, params.type, params.id);
  }
}

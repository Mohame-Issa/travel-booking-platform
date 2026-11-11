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
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '../common/constants/roles.js';
import { CurrentUser, Roles } from '../common/decorators/auth.decorators.js';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiErrors } from './api-errors.decorator.js';
import { CheckOwnership } from '../common/guards/ownership.guard.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import { CreatePaymentDto, PaymentResponseDto } from './dto/payment.dto.js';
import { PaymentsService } from './payments.service.js';
import { Payment } from './schemas/payment.schema.js';

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
@Roles(UserRole.USER)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Start paying for a booking with Stripe (PAY-01, PAY-02, PAY-04)',
    description:
      'Creates a Stripe PaymentIntent (test mode) for a Pending Payment flight booking or hotel reservation ' +
      'inside its 10-minute hold, and returns its clientSecret for Stripe Elements. ' +
      'The amount is computed by the server from the booking, in the single platform currency (PAY-04). Policies must be accepted first (PAY-02). ' +
      'The booking is NOT confirmed here: only the Stripe webhook confirms it. ' +
      'Calling it again while pending returns the same payment.',
  })
  @ApiCreatedResponse({ type: PaymentResponseDto })
  @ApiErrors(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED)
  @ApiErrors(HttpStatus.NOT_FOUND, {
    code: ErrorCode.NOT_FOUND,
    message: 'Booking not found',
  })
  @ApiErrors(
    HttpStatus.CONFLICT,
    ErrorCode.BOOKING_NOT_PAYABLE,
    ErrorCode.HOLD_EXPIRED,
    ErrorCode.POLICIES_NOT_ACCEPTED,
    ErrorCode.PAYMENT_ALREADY_EXISTS,
  )
  @ApiErrors(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.UNSUPPORTED_CURRENCY)
  @ApiErrors(HttpStatus.NOT_IMPLEMENTED, ErrorCode.NOT_IMPLEMENTED)
  @ApiErrors(HttpStatus.BAD_GATEWAY, ErrorCode.PAYMENT_PROVIDER_ERROR)
  @ApiErrors(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.STRIPE_NOT_CONFIGURED)
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.payments.createPayment(userId, dto.bookingType, dto.bookingId);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @CheckOwnership({ model: Payment.name })
  @ApiOperation({
    summary: 'Retry a failed payment (PAY-01)',
    description:
      'Only the owner, only while the booking is Pending Payment inside its 10-minute hold. ' +
      'Reuses the same Stripe PaymentIntent (no second charge possible) and returns a fresh clientSecret ' +
      'for Stripe Elements. No attempt limit: PAY-01 allows retries until the hold expires.',
  })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiErrors(HttpStatus.BAD_REQUEST, ErrorCode.INVALID_ID)
  @ApiErrors(HttpStatus.NOT_FOUND, {
    code: ErrorCode.NOT_FOUND,
    message: 'Payment not found',
  })
  @ApiErrors(
    HttpStatus.CONFLICT,
    ErrorCode.PAYMENT_NOT_RETRYABLE,
    ErrorCode.BOOKING_NOT_PAYABLE,
    ErrorCode.HOLD_EXPIRED,
  )
  @ApiErrors(HttpStatus.NOT_IMPLEMENTED, ErrorCode.NOT_IMPLEMENTED)
  @ApiErrors(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.STRIPE_NOT_CONFIGURED)
  retry(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<PaymentResponseDto> {
    return this.payments.retryPayment(userId, id);
  }

  @Get(':id')
  @CheckOwnership({ model: Payment.name })
  @ApiOperation({
    summary: 'Get a payment and its status (PAY-01)',
    description:
      'Only the owner. Status: pending, failed, succeeded (verified by webhook) or cancelled (hold expired).',
  })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiErrors(HttpStatus.BAD_REQUEST, ErrorCode.INVALID_ID)
  @ApiErrors(HttpStatus.NOT_FOUND, {
    code: ErrorCode.NOT_FOUND,
    message: 'Payment not found',
  })
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<PaymentResponseDto> {
    return this.payments.getPayment(id);
  }
}

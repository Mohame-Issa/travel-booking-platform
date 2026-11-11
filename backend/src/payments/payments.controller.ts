import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserRole } from '../common/constants/roles.js';
import { CurrentUser, Roles } from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { CheckOwnership } from '../common/guards/ownership.guard.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import { CreatePaymentDto, PaymentResponseDto } from './dto/payment.dto.js';
import { PaymentsService } from './payments.service.js';
import { Payment } from './schemas/payment.schema.js';

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
@Roles(UserRole.USER)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Start paying for a booking with Stripe (PAY-01)',
    description:
      'Creates a Stripe PaymentIntent (test mode) for a Pending Payment flight booking or hotel reservation ' +
      'inside its 10-minute hold, and returns its clientSecret for Stripe Elements. ' +
      'The amount is computed by the server from the booking. Policies must be accepted first (PAY-02). ' +
      'The booking is NOT confirmed here: only the Stripe webhook confirms it. ' +
      'Calling it again while pending returns the same payment.',
  })
  @ApiCreatedResponse({ type: PaymentResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_FAILED',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Booking not found',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'BOOKING_NOT_PAYABLE, HOLD_EXPIRED, POLICIES_NOT_ACCEPTED or PAYMENT_ALREADY_EXISTS',
  })
  @ApiBadGatewayResponse({
    type: ErrorResponseDto,
    description: 'PAYMENT_PROVIDER_ERROR (Stripe)',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description: 'STRIPE_NOT_CONFIGURED',
  })
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.payments.createPayment(userId, dto.bookingType, dto.bookingId);
  }

  @Get(':id')
  @CheckOwnership({ model: Payment.name })
  @ApiOperation({
    summary: 'Get a payment and its status (PAY-01)',
    description:
      'Only the owner. Status: pending, failed, succeeded (verified by webhook) or cancelled (hold expired).',
  })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'INVALID_ID' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Payment not found',
  })
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<PaymentResponseDto> {
    return this.payments.getPayment(id);
  }
}

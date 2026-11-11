import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../common/decorators/auth.decorators.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import {
  StripeWebhookService,
  type WebhookResult,
} from './stripe-webhook.service.js';

/**
 * Separate controller because this route is called by Stripe, not by a
 * logged-in user: it is @Public() and is authenticated by the Stripe
 * signature instead of the session cookie.
 */
@ApiTags('Payments')
@Controller('payments/webhook')
export class StripeWebhookController {
  constructor(private readonly webhooks: StripeWebhookService) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stripe webhook: verify payment outcome (PAY-01)',
    description:
      'Called by Stripe (or `stripe listen` locally), not by users or Swagger. ' +
      'The Stripe-Signature header is verified over the raw body with STRIPE_WEBHOOK_SECRET. ' +
      'payment_intent.succeeded confirms the booking; payment_intent.payment_failed marks the ' +
      'payment failed (the user may retry until the hold expires); payment_intent.canceled marks it cancelled. ' +
      'Each event id is processed once; replays return duplicate: true.',
  })
  @ApiHeader({
    name: 'stripe-signature',
    required: true,
    description: 'Set by Stripe',
  })
  @ApiOkResponse({
    schema: { example: { received: true } },
    description:
      'Event accepted (or ignored because it is not ours / already processed)',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'INVALID_WEBHOOK_SIGNATURE',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description: 'STRIPE_NOT_CONFIGURED',
  })
  handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<WebhookResult> {
    return this.webhooks.handle(req.rawBody, signature);
  }
}

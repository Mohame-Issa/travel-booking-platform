import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { placeholderBookingPaymentReaders } from './booking-payment-reader.js';
import { PaymentExpiryService } from './payment-expiry.service.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { PoliciesController } from './policies.controller.js';
import { PoliciesService } from './policies.service.js';
import { Payment, PaymentSchema } from './schemas/payment.schema.js';
import {
  PolicyAcceptance,
  PolicyAcceptanceSchema,
} from './schemas/policy-acceptance.schema.js';
import {
  StripeEvent,
  StripeEventSchema,
} from './schemas/stripe-event.schema.js';
import { StripeWebhookController } from './stripe-webhook.controller.js';
import { StripeWebhookService } from './stripe-webhook.service.js';
import { stripeProvider } from './stripe.provider.js';

/**
 * Payments (PAY-01, PAY-02, PAY-04). Owner: Youssef Khafagy.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: PolicyAcceptance.name, schema: PolicyAcceptanceSchema },
      { name: StripeEvent.name, schema: StripeEventSchema },
    ]),
  ],
  controllers: [
    PoliciesController,
    PaymentsController,
    StripeWebhookController,
  ],
  providers: [
    stripeProvider,
    PoliciesService,
    PaymentsService,
    StripeWebhookService,
    PaymentExpiryService,
    // TODO(Omar Hashem, Mohamed Hashad): remove once the real readers are bound.
    ...placeholderBookingPaymentReaders,
  ],
  exports: [stripeProvider, MongooseModule, PoliciesService, PaymentsService],
})
export class PaymentsModule {}

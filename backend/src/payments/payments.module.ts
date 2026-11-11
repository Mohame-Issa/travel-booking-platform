import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Payment, PaymentSchema } from './schemas/payment.schema.js';
import {
  PolicyAcceptance,
  PolicyAcceptanceSchema,
} from './schemas/policy-acceptance.schema.js';
import {
  StripeEvent,
  StripeEventSchema,
} from './schemas/stripe-event.schema.js';
import { stripeProvider } from './stripe.provider.js';

/**
 * Payments (PAY-01, PAY-02, PAY-04). Owner: Youssef Khafagy.
 * Controllers and services are added in the next steps.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: PolicyAcceptance.name, schema: PolicyAcceptanceSchema },
      { name: StripeEvent.name, schema: StripeEventSchema },
    ]),
  ],
  providers: [stripeProvider],
  exports: [stripeProvider, MongooseModule],
})
export class PaymentsModule {}

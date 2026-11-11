import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { placeholderBookingPaymentReaders } from './booking-payment-reader.js';
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
  controllers: [PoliciesController],
  providers: [
    stripeProvider,
    PoliciesService,
    // TODO(Omar Hashem, Mohamed Hashad): remove once the real readers are bound.
    ...placeholderBookingPaymentReaders,
  ],
  exports: [stripeProvider, MongooseModule, PoliciesService],
})
export class PaymentsModule {}

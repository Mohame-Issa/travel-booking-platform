import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsModule } from '../payments/payments.module.js';
import { Refund, RefundSchema } from './schemas/refund.schema.js';

/**
 * Refunds (PAY-03). Owner: Youssef Khafagy.
 * Imports PaymentsModule for the Payment model and the Stripe client.
 * The REFUND_SERVICE binding (replacing the placeholder) is added in step 7.
 */
@Module({
  imports: [
    PaymentsModule,
    MongooseModule.forFeature([{ name: Refund.name, schema: RefundSchema }]),
  ],
})
export class RefundsModule {}

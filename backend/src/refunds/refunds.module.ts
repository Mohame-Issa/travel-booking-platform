import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { REFUND_SERVICE } from '../common/interfaces/index.js';
import { REFUND_HOOKS } from '../payments/refund-hooks.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { REFUND_PREVIEW_SERVICE } from '../common/interfaces/index.js';
import { RefundsController } from './refunds.controller.js';
import { RefundsService } from './refunds.service.js';
import { Refund, RefundSchema } from './schemas/refund.schema.js';

/**
 * Refunds (PAY-03). Owner: Youssef Khafagy.
 *
 * @Global so Omar Hashem's modules can inject REFUND_SERVICE (and
 * REFUND_PREVIEW_SERVICE) without importing this module, as AI_RULES 8
 * describes. Replaces the REFUND_SERVICE placeholder.
 */
@Global()
@Module({
  imports: [
    PaymentsModule, // Payment model, Stripe client, PoliciesService
    MongooseModule.forFeature([{ name: Refund.name, schema: RefundSchema }]),
  ],
  controllers: [RefundsController],
  providers: [
    RefundsService,
    { provide: REFUND_SERVICE, useExisting: RefundsService },
    { provide: REFUND_PREVIEW_SERVICE, useExisting: RefundsService },
    { provide: REFUND_HOOKS, useExisting: RefundsService },
  ],
  exports: [REFUND_SERVICE, REFUND_PREVIEW_SERVICE, REFUND_HOOKS],
})
export class RefundsModule {}

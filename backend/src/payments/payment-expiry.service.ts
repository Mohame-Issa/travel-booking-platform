import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Stripe from 'stripe';
import {
  type BookingLifecycleService,
  type BookingType,
  FLIGHT_BOOKING_LIFECYCLE,
  HOTEL_BOOKING_LIFECYCLE,
} from '../common/interfaces/index.js';
import { PaymentStatus, STRIPE_CLIENT } from './payments.constants.js';
import { Payment, type PaymentDocument } from './schemas/payment.schema.js';

/**
 * How often we look for expired holds. Technical setting, not a business
 * rule: the hold itself is 10 minutes (FLT-22 / HTL-18).
 */
const CHECK_EVERY_MS = 60_000;

/**
 * PAY-01: "when the hold expires the PaymentIntent is cancelled".
 * PAY-01 / project description 6.4: failed or expired payments leave the
 * booking unconfirmed and release inventory.
 *
 * For every pending/failed payment whose hold has expired:
 *   1. cancel the PaymentIntent at Stripe (so it can never succeed later),
 *   2. mark the payment cancelled,
 *   3. ask the booking module to release the inventory (booking -> Expired).
 * Step 3 is retried on the next run until it succeeds (releasedAt).
 *
 * Omar Hashem's / Mohamed Hashad's own hold-expiry logic may release the same
 * booking too; releaseInventory is idempotent (shared contract), so that is safe.
 */
@Injectable()
export class PaymentExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentExpiryService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe | null,
    @Inject(FLIGHT_BOOKING_LIFECYCLE)
    private readonly flights: BookingLifecycleService,
    @Inject(HOTEL_BOOKING_LIFECYCLE)
    private readonly hotels: BookingLifecycleService,
  ) {}

  onModuleInit(): void {
    if (!this.stripe) return; // payments disabled without a Stripe key
    this.timer = setInterval(() => void this.runOnce(), CHECK_EVERY_MS);
    this.timer.unref(); // never keeps the process (or tests) alive
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass. Public so it can be unit-tested. */
  async runOnce(now = new Date()): Promise<void> {
    if (this.running || !this.stripe) return; // no overlapping runs
    this.running = true;
    try {
      const due = await this.paymentModel
        .find({
          $or: [
            {
              status: { $in: [PaymentStatus.PENDING, PaymentStatus.FAILED] },
              holdExpiresAt: { $lte: now },
            },
            // cancelled earlier but the release did not go through yet
            { status: PaymentStatus.CANCELLED, releasedAt: null },
          ],
        })
        .exec();
      for (const payment of due) {
        try {
          await this.expire(this.stripe, payment);
        } catch (err) {
          // One bad payment must not stop the others; retried next run.
          this.logger.warn(
            `Could not expire payment ${payment.id}: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async expire(
    stripe: Stripe,
    payment: PaymentDocument,
  ): Promise<void> {
    const previous = payment.status;

    if (previous !== PaymentStatus.CANCELLED) {
      const cancelled = await this.cancelIntent(stripe, payment);
      if (!cancelled) return; // it succeeded at the last second: webhook decides

      const res = await this.paymentModel
        .updateOne(
          {
            _id: payment._id,
            status: { $in: [PaymentStatus.PENDING, PaymentStatus.FAILED] },
          },
          { status: PaymentStatus.CANCELLED },
        )
        .exec();
      if (res.modifiedCount === 0) return; // changed meanwhile (e.g. succeeded)
    }

    await this.lifecycle(payment.bookingType).releaseInventory({
      bookingId: payment.bookingId.toString(),
      reason:
        previous === PaymentStatus.FAILED
          ? 'payment_failed'
          : 'payment_expired',
    });
    await this.paymentModel
      .updateOne({ _id: payment._id }, { releasedAt: new Date() })
      .exec();
    this.logger.log(`Payment ${payment.id} expired; inventory released`);
  }

  /**
   * Cancels the PaymentIntent. Returns false if Stripe says it already
   * succeeded (then the webhook handles it, never us).
   */
  private async cancelIntent(
    stripe: Stripe,
    payment: PaymentDocument,
  ): Promise<boolean> {
    try {
      await stripe.paymentIntents.cancel(payment.stripePaymentIntentId);
      return true;
    } catch (err) {
      if (
        err instanceof Stripe.errors.StripeError &&
        err.code === 'payment_intent_unexpected_state'
      ) {
        const intent = await stripe.paymentIntents.retrieve(
          payment.stripePaymentIntentId,
        );
        if (intent.status === 'canceled') return true; // already cancelled
        if (intent.status === 'succeeded') return false;
      }
      throw err; // e.g. still processing: try again next run
    }
  }

  private lifecycle(type: BookingType): BookingLifecycleService {
    return type === 'flight' ? this.flights : this.hotels;
  }
}

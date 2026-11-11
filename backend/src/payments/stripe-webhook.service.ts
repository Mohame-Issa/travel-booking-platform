import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type Stripe from 'stripe';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import {
  type BookingLifecycleService,
  type BookingType,
  FLIGHT_BOOKING_LIFECYCLE,
  HOTEL_BOOKING_LIFECYCLE,
} from '../common/interfaces/index.js';
import { PaymentStatus } from './payments.constants.js';
import { PaymentsService } from './payments.service.js';
import { Payment, type PaymentDocument } from './schemas/payment.schema.js';
import { StripeEvent } from './schemas/stripe-event.schema.js';

/** Mongo duplicate-key error code. */
const DUPLICATE_KEY = 11000;

export interface WebhookResult {
  received: true;
  /** True when this event id was already processed (replay). */
  duplicate?: boolean;
}

/**
 * PAY-01: the ONLY place where a booking gets confirmed.
 * Stripe calls POST /api/payments/webhook with a signed event; we verify the
 * signature with STRIPE_WEBHOOK_SECRET over the RAW request body, so nobody
 * can fake a "payment succeeded" message.
 */
@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(StripeEvent.name)
    private readonly eventModel: Model<StripeEvent>,
    @Inject(FLIGHT_BOOKING_LIFECYCLE)
    private readonly flights: BookingLifecycleService,
    @Inject(HOTEL_BOOKING_LIFECYCLE)
    private readonly hotels: BookingLifecycleService,
    private readonly payments: PaymentsService,
    private readonly config: ConfigService,
  ) {}

  async handle(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<WebhookResult> {
    const event = this.verify(rawBody, signature);

    // Idempotency: record the event id first. A replayed event hits the
    // unique index and is skipped, so nothing is confirmed twice.
    try {
      await this.eventModel.create({ eventId: event.id, type: event.type });
    } catch (err) {
      if ((err as { code?: number }).code === DUPLICATE_KEY) {
        this.logger.log(`Skipping already processed event ${event.id}`);
        return { received: true, duplicate: true };
      }
      throw err;
    }

    try {
      await this.dispatch(event);
    } catch (err) {
      // Processing failed (e.g. database down): forget the event so Stripe's
      // automatic retry processes it again. Stripe retries non-2xx answers.
      await this.eventModel.deleteOne({ eventId: event.id }).exec();
      throw err;
    }
    return { received: true };
  }

  /** Checks the Stripe-Signature header against the raw body. */
  private verify(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Stripe.Event {
    const stripe = this.payments.stripe();
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.STRIPE_NOT_CONFIGURED,
        'STRIPE_WEBHOOK_SECRET is not set',
      );
    }
    if (!rawBody) {
      // Happens only if main.ts does not create the app with { rawBody: true }.
      throw new Error(
        'Raw request body not available: enable rawBody in main.ts',
      );
    }
    if (!signature) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.INVALID_WEBHOOK_SIGNATURE,
        'Missing Stripe-Signature header',
      );
    }
    try {
      return stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.INVALID_WEBHOOK_SIGNATURE,
        'Invalid Stripe signature',
      );
    }
  }

  private async dispatch(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        return this.onSucceeded(event.data.object);
      case 'payment_intent.payment_failed':
        return this.onFailed(event.data.object);
      case 'payment_intent.canceled':
        return this.onCanceled(event.data.object);
      default:
        // Other event types are acknowledged and ignored.
        return;
    }
  }

  /** payment_intent.succeeded -> payment SUCCEEDED -> booking Confirmed (PAY-01). */
  private async onSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
    const payment = await this.findPayment(intent);
    if (!payment) return;

    // Double-check what Stripe actually charged against what we asked for.
    if (
      intent.amount_received !== payment.amountMinor ||
      intent.currency.toUpperCase() !== payment.currency
    ) {
      this.logger.error(
        `Amount mismatch on payment ${payment.id}: expected ${payment.amountMinor} ${payment.currency}, ` +
          `Stripe received ${intent.amount_received} ${intent.currency}. Booking NOT confirmed.`,
      );
      return;
    }

    if (payment.status === PaymentStatus.CANCELLED) {
      // The hold expired before the money arrived (GEN-11 forbids
      // Expired -> Confirmed). TODO(step 7, Youssef): refund in full automatically.
      this.logger.warn(
        `Payment ${payment.id} succeeded after its hold expired`,
      );
      return;
    }

    // pending/failed -> succeeded. The status condition makes it atomic.
    await this.paymentModel
      .updateOne(
        {
          _id: payment._id,
          status: { $in: [PaymentStatus.PENDING, PaymentStatus.FAILED] },
        },
        { status: PaymentStatus.SUCCEEDED, succeededAt: new Date() },
      )
      .exec();

    // Pending Payment -> Confirmed. confirmBooking is idempotent (shared
    // contract), so it is safe to call again when Stripe retries the event.
    try {
      await this.lifecycle(payment.bookingType).confirmBooking({
        bookingId: payment.bookingId.toString(),
        paymentId: payment.id as string,
      });
    } catch (err) {
      if (
        err instanceof HttpException &&
        err.getStatus() === HttpStatus.CONFLICT
      ) {
        // The booking can no longer be confirmed (e.g. it just expired).
        // TODO(step 7, Youssef): refund in full automatically.
        this.logger.warn(
          `Booking for payment ${payment.id} could not be confirmed: ${err.message}`,
        );
        return;
      }
      throw err; // temporary problem: let Stripe retry
    }
  }

  /**
   * payment_intent.payment_failed -> payment FAILED. The booking stays
   * Pending Payment and its inventory stays held: PAY-01 lets the user retry
   * until the hold expires. Release happens at hold expiry (step 6).
   */
  private async onFailed(intent: Stripe.PaymentIntent): Promise<void> {
    const payment = await this.findPayment(intent);
    if (!payment) return;
    await this.paymentModel
      .updateOne(
        { _id: payment._id, status: PaymentStatus.PENDING },
        { status: PaymentStatus.FAILED },
      )
      .exec();
  }

  /** payment_intent.canceled (we cancel it when the hold expires, PAY-01). */
  private async onCanceled(intent: Stripe.PaymentIntent): Promise<void> {
    const payment = await this.findPayment(intent);
    if (!payment) return;
    await this.paymentModel
      .updateOne(
        {
          _id: payment._id,
          status: { $in: [PaymentStatus.PENDING, PaymentStatus.FAILED] },
        },
        { status: PaymentStatus.CANCELLED },
      )
      .exec();
  }

  /**
   * Events for PaymentIntents we did not create (e.g. `stripe trigger`
   * fixtures) are acknowledged and ignored.
   */
  private async findPayment(
    intent: Stripe.PaymentIntent,
  ): Promise<PaymentDocument | null> {
    const payment = await this.paymentModel
      .findOne({ stripePaymentIntentId: intent.id })
      .exec();
    if (!payment) {
      this.logger.log(`No payment for PaymentIntent ${intent.id}; ignoring`);
    }
    return payment;
  }

  private lifecycle(type: BookingType): BookingLifecycleService {
    return type === 'flight' ? this.flights : this.hotels;
  }
}

import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { ErrorCode } from '../common/constants/error-codes.js';
import { PLATFORM_CURRENCY } from '../common/constants/currencies.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import type { BookingType } from '../common/interfaces/index.js';
import type { PaymentResponseDto } from './dto/payment.dto.js';
import { fromMinorUnits, toMinorUnits } from './money.util.js';
import { PaymentStatus, STRIPE_CLIENT } from './payments.constants.js';
import { PoliciesService } from './policies.service.js';
import { Payment, type PaymentDocument } from './schemas/payment.schema.js';

/** Mongo duplicate-key error code. */
const DUPLICATE_KEY = 11000;

/** Stripe PaymentIntent states in which the card can be submitted again. */
const RETRYABLE_INTENT_STATES = new Set<string>([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
]);

/**
 * PAY-01: pay a Pending Payment booking with Stripe (test mode).
 * This service only CREATES the PaymentIntent. The booking is confirmed
 * later by the webhook, never here and never from the client's word.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @Inject(STRIPE_CLIENT) private readonly stripeClient: Stripe | null,
    private readonly policies: PoliciesService,
  ) {}

  /** POST /api/payments */
  async createPayment(
    userId: string,
    type: BookingType,
    bookingId: string,
  ): Promise<PaymentResponseDto> {
    const stripe = this.stripe();

    // 1. Owner only (ACC-11), Pending Payment inside the hold (PAY-01, GEN-11).
    const booking = await this.policies.getOwnedBooking(
      userId,
      type,
      bookingId,
    );
    const holdExpiresAt = this.policies.assertPayable(booking);

    // 2. PAY-02: payment is blocked until the policies are accepted.
    await this.policies.assertAccepted(type, bookingId);

    // 3. One payment per booking. A double click returns the same payment.
    const existing = await this.findByBooking(type, bookingId);
    if (existing) return this.resumeExisting(stripe, existing);

    // 4. Amount comes from the booking, never from the request (PAY-01).
    const currency = this.checkCurrency(booking.currency);
    const amountMinor = toMinorUnits(booking.totalAmount, currency);

    const intent = await this.callStripe(() =>
      stripe.paymentIntents.create(
        {
          amount: amountMinor,
          currency: currency.toLowerCase(),
          // Card only, no redirect-based methods: the result comes back by webhook.
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: 'never',
          },
          // Lets the webhook (and the Stripe dashboard) find the booking.
          metadata: { bookingType: type, bookingId, userId },
        },
        // Stripe returns the SAME PaymentIntent if this request is repeated,
        // so two parallel requests cannot create two charges.
        { idempotencyKey: `payment-${type}-${bookingId}` },
      ),
    );

    try {
      const payment = await this.paymentModel.create({
        userId: new Types.ObjectId(userId),
        bookingType: type,
        bookingId: new Types.ObjectId(bookingId),
        stripePaymentIntentId: intent.id,
        amountMinor,
        currency,
        status: PaymentStatus.PENDING,
        holdExpiresAt,
      });
      return toResponse(payment, intent.client_secret);
    } catch (err) {
      // A parallel request saved it first (unique bookingType+bookingId).
      if ((err as { code?: number }).code === DUPLICATE_KEY) {
        const winner = await this.findByBooking(type, bookingId);
        if (winner) return toResponse(winner, intent.client_secret);
      }
      throw err;
    }
  }

  /**
   * POST /api/payments/:id/retry (ownership is checked by @CheckOwnership).
   * PAY-01: after a failure the user may retry until the hold expires.
   * There is no attempt limit in the requirements, so none is enforced.
   *
   * We reuse the SAME PaymentIntent: after a decline Stripe puts it back to
   * "requires_payment_method", so the frontend confirms it again with another
   * card. One PaymentIntent per booking = no risk of charging twice.
   */
  async retryPayment(
    userId: string,
    paymentId: string,
  ): Promise<PaymentResponseDto> {
    const stripe = this.stripe();
    const payment = await this.paymentModel.findById(paymentId).exec();
    if (!payment) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Payment not found',
      );
    }
    if (
      payment.status !== PaymentStatus.FAILED &&
      payment.status !== PaymentStatus.PENDING
    ) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.PAYMENT_NOT_RETRYABLE,
        `A ${payment.status} payment cannot be retried`,
      );
    }

    // The booking must still be Pending Payment and inside its hold.
    const booking = await this.policies.getOwnedBooking(
      userId,
      payment.bookingType,
      payment.bookingId.toString(),
    );
    this.policies.assertPayable(booking);

    const intent = await this.callStripe(() =>
      stripe.paymentIntents.retrieve(payment.stripePaymentIntentId),
    );
    if (!RETRYABLE_INTENT_STATES.has(intent.status)) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.PAYMENT_NOT_RETRYABLE,
        `The payment is ${intent.status} at Stripe and cannot be retried`,
      );
    }

    // failed -> pending (only if it is still failed: atomic).
    await this.paymentModel
      .updateOne(
        { _id: payment._id, status: PaymentStatus.FAILED },
        { status: PaymentStatus.PENDING },
      )
      .exec();
    payment.status = PaymentStatus.PENDING;
    return toResponse(payment, intent.client_secret);
  }

  /** GET /api/payments/:id (ownership is checked by @CheckOwnership). */
  async getPayment(paymentId: string): Promise<PaymentResponseDto> {
    const payment = await this.paymentModel.findById(paymentId).exec();
    if (!payment) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Payment not found',
      );
    }
    return toResponse(payment);
  }

  findByBooking(
    type: BookingType,
    bookingId: string,
  ): Promise<PaymentDocument | null> {
    return this.paymentModel
      .findOne({ bookingType: type, bookingId: new Types.ObjectId(bookingId) })
      .exec();
  }

  /** Returns the configured Stripe client or answers 503. */
  stripe(): Stripe {
    if (!this.stripeClient) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.STRIPE_NOT_CONFIGURED,
        'Payments are not configured on this server (STRIPE_SECRET_KEY missing)',
      );
    }
    return this.stripeClient;
  }

  /**
   * Turns Stripe API errors into our error format (502). The Stripe message
   * is safe to show; it never contains keys or card numbers.
   */
  async callStripe<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError) {
        this.logger.warn(`Stripe error ${err.type}: ${err.message}`);
        throw new ApiException(
          HttpStatus.BAD_GATEWAY,
          ErrorCode.PAYMENT_PROVIDER_ERROR,
          `Payment provider error: ${err.message}`,
        );
      }
      throw err;
    }
  }

  /** A pending payment can be resumed; any other state must use retry or is final. */
  private async resumeExisting(
    stripe: Stripe,
    payment: PaymentDocument,
  ): Promise<PaymentResponseDto> {
    if (payment.status !== PaymentStatus.PENDING) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.PAYMENT_ALREADY_EXISTS,
        payment.status === PaymentStatus.FAILED
          ? 'The previous attempt failed. Use POST /api/payments/:id/retry'
          : `This booking already has a ${payment.status} payment`,
      );
    }
    // The client secret is not stored (PAY-01), so fetch it again from Stripe.
    const intent = await this.callStripe(() =>
      stripe.paymentIntents.retrieve(payment.stripePaymentIntentId),
    );
    return toResponse(payment, intent.client_secret);
  }

  /**
   * PAY-04: all prices, payments and refunds use a single platform currency.
   * A booking in any other currency cannot be paid.
   */
  private checkCurrency(currency: string): string {
    const code = currency.toUpperCase();
    if (code !== PLATFORM_CURRENCY) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.UNSUPPORTED_CURRENCY,
        `Currency ${code} is not supported; payments use ${PLATFORM_CURRENCY} (PAY-04)`,
      );
    }
    return code;
  }
}

function toResponse(
  p: PaymentDocument,
  clientSecret?: string | null,
): PaymentResponseDto {
  return {
    id: p.id as string,
    bookingType: p.bookingType,
    bookingId: p.bookingId.toString(),
    status: p.status,
    amount: fromMinorUnits(p.amountMinor, p.currency),
    amountMinor: p.amountMinor,
    currency: p.currency,
    stripePaymentIntentId: p.stripePaymentIntentId,
    holdExpiresAt: p.holdExpiresAt,
    succeededAt: p.succeededAt,
    createdAt: p.createdAt,
    ...(clientSecret ? { clientSecret } : {}),
  };
}

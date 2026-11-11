import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import {
  type BookingType,
  type CreateRefundInput,
  NOTIFICATION_SERVICE,
  type NotificationService,
  type RefundResult,
  type RefundService,
  type RefundStatus,
} from '../common/interfaces/index.js';
import { fromMinorUnits } from '../payments/money.util.js';
import {
  PaymentStatus,
  STRIPE_CLIENT,
} from '../payments/payments.constants.js';
import { PoliciesService } from '../payments/policies.service.js';
import type { RefundHooks } from '../payments/refund-hooks.js';
import {
  Payment,
  type PaymentDocument,
} from '../payments/schemas/payment.schema.js';
import type { RefundResponseDto } from './dto/refund.dto.js';
import {
  calculateRefund,
  type RefundCalculation,
} from './refund-calculator.js';
import type {
  RefundPreview,
  RefundPreviewService,
} from '../common/interfaces/index.js';
import { Refund, type RefundDocument } from './schemas/refund.schema.js';

/** Mongo duplicate-key error code. */
const DUPLICATE_KEY = 11000;

/** PAY-03 labels shown to the user. */
const STATUS_LABEL: Record<RefundStatus, 'Pending' | 'Refunded' | 'Failed'> = {
  pending: 'Pending',
  succeeded: 'Refunded',
  failed: 'Failed',
};

/**
 * PAY-03: refunds through the Stripe Refunds API.
 * Called by Omar Hashem's cancellation endpoints and flight.cancelled handler
 * through the shared REFUND_SERVICE token.
 */
@Injectable()
export class RefundsService
  implements RefundService, RefundPreviewService, RefundHooks
{
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @InjectModel(Refund.name) private readonly refundModel: Model<Refund>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe | null,
    @Inject(NOTIFICATION_SERVICE)
    private readonly notifications: NotificationService,
    private readonly policies: PoliciesService,
  ) {}

  /**
   * Shared contract (common/interfaces/refund.interface.ts).
   * Idempotent: a second call for the same booking returns the first refund.
   */
  async createRefund(input: CreateRefundInput): Promise<RefundResult> {
    const existing = await this.findByBooking(
      input.bookingType,
      input.bookingId,
    );
    if (existing) return toResult(existing);

    const payment = await this.succeededPayment(
      input.bookingType,
      input.bookingId,
    );
    const calc = await this.calculate(input, payment);

    const { refund, created } = await this.insertRefund(payment, {
      reason: input.reason,
      requestedBy: input.requestedBy
        ? new Types.ObjectId(input.requestedBy)
        : null,
      ...calc,
    });
    if (!created) return toResult(refund); // a parallel call won the race
    return toResult(await this.sendToStripe(refund, payment));
  }

  /** Same maths as createRefund, nothing saved (FLT-26 / HTL-21 preview). */
  async previewRefund(
    input: Omit<CreateRefundInput, 'requestedBy'>,
  ): Promise<RefundPreview> {
    const payment = await this.succeededPayment(
      input.bookingType,
      input.bookingId,
    );
    const calc = await this.calculate(input, payment);
    return {
      amount: fromMinorUnits(calc.amountMinor, payment.currency),
      currency: payment.currency,
      refundPercentage: calc.refundPercentage,
      daysBeforeStart: calc.daysBeforeStart,
      appliedTierDaysBefore: calc.appliedTierDaysBefore,
    };
  }

  /** RefundHooks: money arrived after the hold expired -> 100% back. */
  async refundLatePayment(paymentId: string): Promise<void> {
    const payment = await this.paymentModel.findById(paymentId).exec();
    if (!payment) return;
    const { refund, created } = await this.insertRefund(payment, {
      reason: 'late_payment',
      requestedBy: null,
      refundPercentage: 100,
      daysBeforeStart: null,
      appliedTierDaysBefore: null,
      amountMinor: payment.amountMinor,
    });
    if (created) await this.sendToStripe(refund, payment);
  }

  /** RefundHooks: Stripe refund.updated / refund.failed events. */
  async onStripeRefundUpdated(stripeRefund: Stripe.Refund): Promise<void> {
    await this.refundModel
      .updateOne(
        { stripeRefundId: stripeRefund.id },
        { status: mapStripeStatus(stripeRefund.status) },
      )
      .exec();
  }

  /** GET /api/refunds/:id (ownership is checked by @CheckOwnership). */
  async getRefund(refundId: string): Promise<RefundResponseDto> {
    const refund = await this.refundModel.findById(refundId).exec();
    if (!refund) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Refund not found',
      );
    }
    return toResponse(refund);
  }

  findByBooking(
    type: BookingType,
    bookingId: string,
  ): Promise<RefundDocument | null> {
    return this.refundModel
      .findOne({ bookingType: type, bookingId: new Types.ObjectId(bookingId) })
      .exec();
  }

  /** Only a booking that was actually paid can be refunded. */
  private async succeededPayment(
    type: BookingType,
    bookingId: string,
  ): Promise<PaymentDocument> {
    const payment = await this.paymentModel
      .findOne({
        bookingType: type,
        bookingId: new Types.ObjectId(bookingId),
        status: PaymentStatus.SUCCEEDED,
      })
      .exec();
    if (!payment) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.REFUND_NOT_POSSIBLE,
        'This booking has no successful payment to refund',
      );
    }
    return payment;
  }

  /**
   * PAY-03: provider-initiated cancellations at 100%; user cancellations per
   * the provider's tiers. We use the tiers the user ACCEPTED before paying
   * (PAY-02 snapshot), not whatever the moderator changed them to later.
   */
  private async calculate(
    input: Omit<CreateRefundInput, 'requestedBy'>,
    payment: PaymentDocument,
  ): Promise<RefundCalculation> {
    const providerInitiated =
      input.fullRefund === true || input.reason !== 'user_cancellation';
    if (providerInitiated) {
      return calculateRefund({
        paidAmountMinor: payment.amountMinor,
        tiers: [],
        startsAt: new Date(),
        now: new Date(),
        fullRefund: true,
      });
    }

    const acceptance = await this.policies.assertAccepted(
      input.bookingType,
      input.bookingId,
    );
    const booking = await this.policies.getBooking(
      input.bookingType,
      input.bookingId,
    );
    if (!booking) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Booking not found',
      );
    }
    return calculateRefund({
      paidAmountMinor: payment.amountMinor,
      tiers: acceptance.cancellationTiers,
      startsAt: booking.startsAt, // flight departure / hotel check-in
      now: new Date(),
      fullRefund: false,
    });
  }

  /**
   * Saves the refund BEFORE calling Stripe. The unique (bookingType, bookingId)
   * index means only one refund per booking can ever exist, even if two
   * requests arrive at the same time. Returns the existing one on a race.
   */
  private async insertRefund(
    payment: PaymentDocument,
    fields: Pick<
      Refund,
      | 'reason'
      | 'requestedBy'
      | 'refundPercentage'
      | 'daysBeforeStart'
      | 'appliedTierDaysBefore'
      | 'amountMinor'
    >,
  ): Promise<{ refund: RefundDocument; created: boolean }> {
    try {
      const created = await this.refundModel.create({
        paymentId: payment._id,
        userId: payment.userId,
        bookingType: payment.bookingType,
        bookingId: payment.bookingId,
        currency: payment.currency,
        // PAY-03: Stripe is only called for a positive amount. 0 = nothing to refund.
        status: fields.amountMinor > 0 ? 'pending' : 'succeeded',
        ...fields,
      });
      return { refund: created, created: true };
    } catch (err) {
      if ((err as { code?: number }).code === DUPLICATE_KEY) {
        const winner = await this.findByBooking(
          payment.bookingType,
          payment.bookingId.toString(),
        );
        if (winner) return { refund: winner, created: false };
      }
      throw err;
    }
  }

  /**
   * Calls the Stripe Refunds API for a positive amount and notifies the user.
   * If Stripe refuses, the refund is recorded as Failed (shown to the user)
   * instead of undoing the cancellation.
   */
  private async sendToStripe(
    refund: RefundDocument,
    payment: PaymentDocument,
  ): Promise<RefundDocument> {
    if (refund.amountMinor === 0) return refund;

    if (!this.stripe) {
      refund.status = 'failed';
      await refund.save();
      this.logger.error(
        `Refund ${refund.id} failed: STRIPE_SECRET_KEY is not set`,
      );
      return refund;
    }

    try {
      const stripeRefund = await this.stripe.refunds.create(
        {
          payment_intent: payment.stripePaymentIntentId,
          amount: refund.amountMinor,
        },
        // Same refund document -> same Stripe refund, even if this is retried.
        { idempotencyKey: `refund-${refund.id as string}` },
      );
      refund.stripeRefundId = stripeRefund.id;
      refund.status = mapStripeStatus(stripeRefund.status);
    } catch (err) {
      if (!(err instanceof Stripe.errors.StripeError)) throw err;
      this.logger.error(`Stripe refused refund ${refund.id}: ${err.message}`);
      refund.status = 'failed';
    }
    await refund.save();

    // PAY-03: the user receives an in-app notification (GEN-01).
    const amount = `${fromMinorUnits(refund.amountMinor, refund.currency)} ${refund.currency}`;
    await this.notifications.notify({
      userId: refund.userId.toString(),
      type: 'refund_issued',
      title: 'Refund issued',
      message: `Your refund of ${amount} for your ${refund.bookingType} booking is ${STATUS_LABEL[refund.status]}.`,
      data: {
        bookingType: refund.bookingType,
        bookingId: refund.bookingId.toString(),
        refundId: refund.id as string,
      },
    });
    return refund;
  }
}

/** Stripe refund status -> our RefundStatus. */
function mapStripeStatus(status: string | null): RefundStatus {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed' || status === 'canceled') return 'failed';
  return 'pending'; // pending, requires_action
}

function toResult(r: RefundDocument): RefundResult {
  return {
    refundId: r.id as string,
    amount: fromMinorUnits(r.amountMinor, r.currency),
    currency: r.currency,
    status: r.status,
  };
}

function toResponse(r: RefundDocument): RefundResponseDto {
  return {
    id: r.id as string,
    paymentId: r.paymentId.toString(),
    bookingType: r.bookingType,
    bookingId: r.bookingId.toString(),
    reason: r.reason,
    status: r.status,
    statusLabel: STATUS_LABEL[r.status],
    refundPercentage: r.refundPercentage,
    daysBeforeStart: r.daysBeforeStart,
    appliedTierDaysBefore: r.appliedTierDaysBefore,
    amount: fromMinorUnits(r.amountMinor, r.currency),
    amountMinor: r.amountMinor,
    currency: r.currency,
    stripeRefundId: r.stripeRefundId ?? null,
    createdAt: r.createdAt,
  };
}

import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import {
  type BookingType,
  type CreateRefundInput,
  type FareDifferenceRefundInput,
  type FareDifferenceRefundService,
  NOTIFICATION_SERVICE,
  type NotificationService,
  type RefundReason,
  type RefundResult,
  type RefundService,
  type RefundStatus,
} from '../common/interfaces/index.js';
import { fromMinorUnits, toMinorUnits } from '../payments/money.util.js';
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

/** Refund reasons that come from cancelling the booking (PAY-03). */
const CANCELLATION_REASONS: RefundReason[] = [
  'user_cancellation',
  'provider_cancellation',
  'flight_cancelled',
];

/** One payment and how much of it can still be refunded. */
interface Refundable {
  payment: PaymentDocument;
  remainingMinor: number;
}

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
  implements
    RefundService,
    RefundPreviewService,
    RefundHooks,
    FareDifferenceRefundService,
    OnModuleInit
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
   * The refunds collection used to allow one refund per booking. A booking
   * changed to a dearer flight (FLT-27) has two payments, so that index was
   * replaced by the refundKey index. Drop the old one if this database still
   * has it (only our own collection, never data).
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.refundModel.collection.dropIndex('bookingType_1_bookingId_1');
      this.logger.log('Dropped the old one-refund-per-booking index');
    } catch {
      // Not there (new database or already dropped): nothing to do.
    }
  }

  /**
   * Shared contract (common/interfaces/refund.interface.ts).
   * Idempotent: a second call for the same booking returns the first refund.
   * PAY-03: a refund is issued and recorded only for a POSITIVE amount. If the
   * policy gives 0%, nothing is saved and { refundId: null, status: 'none' }
   * is returned.
   */
  async createRefund(input: CreateRefundInput): Promise<RefundResult> {
    const existing = await this.cancellationRefunds(
      input.bookingType,
      input.bookingId,
    );
    if (existing.length) return aggregate(existing);

    const refundable = await this.refundable(
      input.bookingType,
      input.bookingId,
    );
    const calc = await this.calculate(input, totalOf(refundable));
    const currency = refundable[0].payment.currency;
    if (calc.amountMinor === 0) {
      return { refundId: null, amount: 0, currency, status: 'none' };
    }

    const refunds = await this.issue(
      refundable,
      calc.amountMinor,
      (payment) => ({
        refundKey: `cancel:${input.bookingId}:${payment.id as string}`,
        bookingId: new Types.ObjectId(input.bookingId),
        changeId: null,
        reason: input.reason,
        requestedBy: input.requestedBy
          ? new Types.ObjectId(input.requestedBy)
          : null,
        refundPercentage: calc.refundPercentage,
        daysBeforeStart: calc.daysBeforeStart,
        appliedTierDaysBefore: calc.appliedTierDaysBefore,
      }),
    );
    return aggregate(refunds);
  }

  /** Same maths as createRefund, nothing saved (FLT-26 / HTL-21 preview). */
  async previewRefund(
    input: Omit<CreateRefundInput, 'requestedBy'>,
  ): Promise<RefundPreview> {
    const refundable = await this.refundable(
      input.bookingType,
      input.bookingId,
    );
    const currency = refundable[0].payment.currency;
    const calc = await this.calculate(input, totalOf(refundable));
    return {
      amount: fromMinorUnits(calc.amountMinor, currency),
      currency,
      refundPercentage: calc.refundPercentage,
      daysBeforeStart: calc.daysBeforeStart,
      appliedTierDaysBefore: calc.appliedTierDaysBefore,
    };
  }

  /**
   * FLT-27 (bonus): the user changed to a cheaper flight; the difference goes
   * back to the card. Idempotent per change. Never more than what is still
   * refundable on the booking's payments.
   */
  async refundFareDifference(
    input: FareDifferenceRefundInput,
  ): Promise<RefundResult> {
    const existing = await this.refundModel
      .find({ changeId: new Types.ObjectId(input.changeId) })
      .sort({ createdAt: 1 })
      .exec();
    if (existing.length) return aggregate(existing);

    const refundable = await this.refundable(
      input.bookingType,
      input.bookingId,
    );
    const currency = refundable[0].payment.currency;
    const amountMinor = Math.min(
      toMinorUnits(input.amount, currency),
      totalOf(refundable),
    );
    if (amountMinor <= 0) {
      return { refundId: null, amount: 0, currency, status: 'none' };
    }
    const refunds = await this.issue(refundable, amountMinor, (payment) => ({
      refundKey: `fare:${input.changeId}:${payment.id as string}`,
      bookingId: new Types.ObjectId(input.bookingId),
      changeId: new Types.ObjectId(input.changeId),
      reason: 'fare_difference',
      requestedBy: input.requestedBy
        ? new Types.ObjectId(input.requestedBy)
        : null,
      refundPercentage: 100, // the whole difference is refunded
      daysBeforeStart: null,
      appliedTierDaysBefore: null,
    }));
    return aggregate(refunds);
  }

  /** RefundHooks: money arrived after the hold expired -> 100% back. */
  async refundLatePayment(paymentId: string): Promise<void> {
    const payment = await this.paymentModel.findById(paymentId).exec();
    if (!payment) return;
    const { refund, created } = await this.insertRefund(payment, {
      refundKey: `late:${payment.id as string}`,
      bookingId: payment.bookingId,
      changeId: null,
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

  /** The cancellation refund(s) of a booking, oldest first. */
  private cancellationRefunds(
    type: BookingType,
    bookingId: string,
  ): Promise<RefundDocument[]> {
    return this.refundModel
      .find({
        bookingType: type,
        bookingId: new Types.ObjectId(bookingId),
        reason: { $in: CANCELLATION_REASONS },
      })
      .sort({ createdAt: 1 })
      .exec();
  }

  /**
   * The booking's successful payments, NEWEST first, with what is still
   * refundable on each (amount minus refunds that did not fail). Normally one
   * payment; two or more after a change to a dearer flight (FLT-27). Only a
   * booking that was actually paid can be refunded.
   */
  private async refundable(
    type: BookingType,
    bookingId: string,
  ): Promise<Refundable[]> {
    const id = new Types.ObjectId(bookingId);
    const payments = await this.paymentModel
      .find({
        bookingType: type,
        status: PaymentStatus.SUCCEEDED,
        $or: [{ bookingId: id }, { parentBookingId: id }],
      })
      .sort({ createdAt: -1 })
      .exec();
    if (!payments.length) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.REFUND_NOT_POSSIBLE,
        'This booking has no successful payment to refund',
      );
    }
    const refunded = await this.refundModel
      .find({
        paymentId: { $in: payments.map((p) => p._id) },
        status: { $ne: 'failed' },
      })
      .exec();
    return payments.map((payment) => ({
      payment,
      remainingMinor:
        payment.amountMinor -
        refunded
          .filter((r) => r.paymentId.toString() === payment.id)
          .reduce((sum, r) => sum + r.amountMinor, 0),
    }));
  }

  /**
   * Splits `amountMinor` over the payments, newest first, never more than is
   * left on each, then saves and sends each part. A booking with one payment
   * gives one refund, exactly as before FLT-27.
   */
  private async issue(
    refundable: Refundable[],
    amountMinor: number,
    fieldsFor: (payment: PaymentDocument) => RefundFields,
  ): Promise<RefundDocument[]> {
    const out: RefundDocument[] = [];
    let left = amountMinor;
    for (const { payment, remainingMinor } of refundable) {
      if (left <= 0) break;
      const part = Math.min(left, remainingMinor);
      if (part <= 0) continue;
      left -= part;
      const { refund, created } = await this.insertRefund(payment, {
        ...fieldsFor(payment),
        amountMinor: part,
      });
      out.push(created ? await this.sendToStripe(refund, payment) : refund);
    }
    return out;
  }

  /**
   * PAY-03: provider-initiated cancellations at 100%; user cancellations per
   * the provider's tiers. We use the tiers the user ACCEPTED before paying
   * (PAY-02 snapshot), not whatever the moderator changed them to later.
   * `paidAmountMinor` is what is still refundable on the booking.
   */
  private async calculate(
    input: Omit<CreateRefundInput, 'requestedBy'>,
    paidAmountMinor: number,
  ): Promise<RefundCalculation> {
    const providerInitiated =
      input.fullRefund === true || input.reason !== 'user_cancellation';
    if (providerInitiated) {
      return calculateRefund({
        paidAmountMinor,
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
      paidAmountMinor,
      tiers: acceptance.cancellationTiers,
      startsAt: booking.startsAt, // flight departure / hotel check-in
      now: new Date(),
      fullRefund: false,
    });
  }

  /**
   * Saves the refund BEFORE calling Stripe. The unique refundKey index means
   * the same refund can never be saved twice, even if two requests arrive at
   * the same time. Returns the existing one on a race.
   */
  private async insertRefund(
    payment: PaymentDocument,
    fields: RefundFields & Pick<Refund, 'amountMinor'>,
  ): Promise<{ refund: RefundDocument; created: boolean }> {
    try {
      const created = await this.refundModel.create({
        paymentId: payment._id,
        userId: payment.userId,
        bookingType: payment.bookingType,
        currency: payment.currency,
        status: 'pending', // until Stripe answers
        ...fields,
      });
      return { refund: created, created: true };
    } catch (err) {
      if ((err as { code?: number }).code === DUPLICATE_KEY) {
        const winner = await this.refundModel
          .findOne({ refundKey: fields.refundKey })
          .exec();
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

type RefundFields = Pick<
  Refund,
  | 'refundKey'
  | 'bookingId'
  | 'changeId'
  | 'reason'
  | 'requestedBy'
  | 'refundPercentage'
  | 'daysBeforeStart'
  | 'appliedTierDaysBefore'
>;

function totalOf(refundable: Refundable[]): number {
  return refundable.reduce((sum, r) => sum + Math.max(0, r.remainingMinor), 0);
}

/**
 * One result for one or more refund parts: the first part's id, the total
 * amount, and the "worst" status (failed > pending > succeeded).
 */
function aggregate(refunds: RefundDocument[]): RefundResult {
  const first = refunds[0];
  const statuses = new Set(refunds.map((r) => r.status));
  const status: RefundStatus = statuses.has('failed')
    ? 'failed'
    : statuses.has('pending')
      ? 'pending'
      : 'succeeded';
  return {
    refundId: first.id as string,
    amount: fromMinorUnits(
      refunds.reduce((sum, r) => sum + r.amountMinor, 0),
      first.currency,
    ),
    currency: first.currency,
    status,
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

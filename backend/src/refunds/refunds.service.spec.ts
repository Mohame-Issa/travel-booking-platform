import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../common/constants/error-codes.js';
import type { ApiException } from '../common/exceptions/api.exception.js';
import { RefundsService } from './refunds.service.js';

const DAY = 86_400_000;
const OWNER = '64b000000000000000000001';
const BOOKING = '64b0000000000000000000aa';

function payment() {
  return {
    _id: 'pay_1',
    id: 'pay_1',
    userId: { toString: () => OWNER },
    bookingType: 'flight',
    bookingId: { toString: () => BOOKING },
    stripePaymentIntentId: 'pi_123',
    amountMinor: 25050,
    currency: 'USD',
  };
}

function setup(
  opts: { payment?: unknown; existing?: unknown; daysAhead?: number } = {},
) {
  const saved: Record<string, unknown>[] = [];
  // find() serves both "existing cancellation refunds" and "already refunded
  // on this payment": with `existing` set, createRefund returns early.
  const found = opts.existing ? [opts.existing] : [];
  const refundModel = {
    findOne: vi
      .fn()
      .mockReturnValue({ exec: () => Promise.resolve(opts.existing ?? null) }),
    find: vi.fn().mockReturnValue({
      sort: () => ({ exec: () => Promise.resolve(found) }),
      exec: () => Promise.resolve(found),
    }),
    create: vi.fn().mockImplementation((doc: Record<string, unknown>) => {
      const created = {
        ...doc,
        id: 'ref_1',
        save: vi.fn().mockImplementation(function (
          this: Record<string, unknown>,
        ) {
          saved.push({ ...this });
          return Promise.resolve(this);
        }),
      };
      return Promise.resolve(created);
    }),
  };
  const pay = opts.payment === undefined ? payment() : opts.payment;
  const paymentModel = {
    findOne: vi.fn().mockReturnValue({ exec: () => Promise.resolve(pay) }),
    find: vi.fn().mockReturnValue({
      sort: () => ({ exec: () => Promise.resolve(pay ? [pay] : []) }),
    }),
    findById: vi.fn().mockReturnValue({ exec: () => Promise.resolve(pay) }),
  };
  const stripe = {
    refunds: {
      create: vi.fn().mockResolvedValue({ id: 're_1', status: 'succeeded' }),
    },
  };
  const notifications = {
    notify: vi.fn().mockResolvedValue(undefined),
    notifyMany: vi.fn(),
  };
  const policies = {
    assertAccepted: vi.fn().mockResolvedValue({
      cancellationTiers: [
        { daysBefore: 7, refundPercentage: 50 },
        { daysBefore: 30, refundPercentage: 100 },
      ],
    }),
    getBooking: vi.fn().mockResolvedValue({
      startsAt: new Date(Date.now() + (opts.daysAhead ?? 10) * DAY + 60_000),
    }),
  };
  const service = new RefundsService(
    refundModel as never,
    paymentModel as never,
    stripe as never,
    notifications,
    policies as never,
  );
  return { service, refundModel, stripe, notifications, policies, saved };
}

const userCancel = {
  bookingType: 'flight' as const,
  bookingId: BOOKING,
  reason: 'user_cancellation' as const,
};

describe('RefundsService.createRefund (PAY-03)', () => {
  it('user cancellation: uses the accepted tiers, refunds via Stripe and notifies', async () => {
    const { service, stripe, notifications } = setup({ daysAhead: 10 });
    const res = await service.createRefund({
      ...userCancel,
      requestedBy: OWNER,
    });

    expect(stripe.refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_123', amount: 12525 },
      { idempotencyKey: 'refund-ref_1' },
    );
    expect(res).toEqual({
      refundId: 'ref_1',
      amount: 125.25,
      currency: 'USD',
      status: 'succeeded',
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OWNER, type: 'refund_issued' }),
    );
  });

  it('provider cancellation / flight cancelled: 100% regardless of tiers', async () => {
    const { service, stripe, policies } = setup({ daysAhead: 1 });
    await service.createRefund({
      bookingType: 'flight',
      bookingId: BOOKING,
      reason: 'flight_cancelled',
      fullRefund: true,
    });
    expect(stripe.refunds.create.mock.calls[0][0]).toEqual({
      payment_intent: 'pi_123',
      amount: 25050,
    });
    expect(policies.assertAccepted).not.toHaveBeenCalled();
  });

  it('0% refund: nothing recorded, no Stripe call, no notification (PAY-03: positive amounts only)', async () => {
    const { service, stripe, notifications, refundModel } = setup({
      daysAhead: 2,
    });
    const res = await service.createRefund(userCancel);
    expect(res).toEqual({
      refundId: null,
      amount: 0,
      currency: 'USD',
      status: 'none',
    });
    expect(refundModel.create).not.toHaveBeenCalled();
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('is idempotent: a second call returns the existing refund', async () => {
    const existing = {
      id: 'ref_1',
      amountMinor: 12525,
      currency: 'USD',
      status: 'pending',
    };
    const { service, stripe, refundModel } = setup({ existing });
    const res = await service.createRefund(userCancel);
    expect(res).toEqual({
      refundId: 'ref_1',
      amount: 125.25,
      currency: 'USD',
      status: 'pending',
    });
    expect(refundModel.create).not.toHaveBeenCalled();
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('409 REFUND_NOT_POSSIBLE when the booking was never paid', async () => {
    const { service } = setup({ payment: null });
    const err = (await service
      .createRefund(userCancel)
      .catch((e: unknown) => e)) as ApiException;
    expect(err.code).toBe(ErrorCode.REFUND_NOT_POSSIBLE);
  });

  it('Stripe refusal is recorded as Failed instead of undoing the cancellation', async () => {
    const { service, stripe } = setup();
    stripe.refunds.create.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        message: 'charge already refunded',
        type: 'invalid_request_error',
      }),
    );
    const res = await service.createRefund(userCancel);
    expect(res.status).toBe('failed');
  });

  it('previewRefund uses the same maths and saves nothing', async () => {
    const { service, refundModel, stripe } = setup({ daysAhead: 10 });
    expect(await service.previewRefund(userCancel)).toEqual({
      amount: 125.25,
      currency: 'USD',
      refundPercentage: 50,
      daysBeforeStart: 10,
      appliedTierDaysBefore: 7,
    });
    expect(refundModel.create).not.toHaveBeenCalled();
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('refundLatePayment refunds 100% with reason late_payment', async () => {
    const { service, stripe, refundModel } = setup();
    await service.refundLatePayment('pay_1');
    expect(refundModel.create.mock.calls[0][0]).toMatchObject({
      reason: 'late_payment',
      refundPercentage: 100,
    });
    expect(stripe.refunds.create.mock.calls[0][0]).toEqual({
      payment_intent: 'pi_123',
      amount: 25050,
    });
  });
});

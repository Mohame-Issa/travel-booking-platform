import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../common/constants/error-codes.js';
import type { ApiException } from '../common/exceptions/api.exception.js';
import { PaymentStatus } from './payments.constants.js';
import { PaymentsService } from './payments.service.js';

const OWNER = '64b000000000000000000001';
const BOOKING = '64b0000000000000000000aa';
const HOLD = new Date(Date.now() + 5 * 60_000);

function setup(
  opts: { existing?: Record<string, unknown> | null; currency?: string } = {},
) {
  const policies = {
    getOwnedBooking: vi.fn().mockResolvedValue({
      bookingId: BOOKING,
      userId: OWNER,
      totalAmount: 250.5,
      currency: opts.currency ?? 'EGP',
      holdExpiresAt: HOLD,
    }),
    assertPayable: vi.fn().mockReturnValue(HOLD),
    assertAccepted: vi.fn().mockResolvedValue({}),
  };
  const stripe = {
    paymentIntents: {
      create: vi
        .fn()
        .mockResolvedValue({ id: 'pi_123', client_secret: 'pi_123_secret_x' }),
      retrieve: vi
        .fn()
        .mockResolvedValue({ id: 'pi_123', client_secret: 'pi_123_secret_x' }),
    },
  };
  const model = {
    findOne: vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(opts.existing ?? null),
    }),
    create: vi.fn().mockImplementation((doc: Record<string, unknown>) =>
      Promise.resolve({
        ...doc,
        id: 'pay_1',
        succeededAt: null,
        createdAt: new Date(),
      }),
    ),
  };
  const service = new PaymentsService(
    model as never,
    stripe as never,
    policies as never,
  );
  return { service, stripe, model, policies };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as ApiException).code;
  }
  return 'NO_ERROR';
}

describe('PaymentsService.createPayment (PAY-01)', () => {
  it('computes the amount from the booking in minor units and returns the client secret', async () => {
    const { service, stripe } = setup();
    const res = await service.createPayment(OWNER, 'flight', BOOKING);

    const [params, options] = stripe.paymentIntents.create.mock.calls[0];
    expect(params.amount).toBe(25050);
    expect(params.currency).toBe('egp');
    expect(params.metadata).toEqual({
      bookingType: 'flight',
      bookingId: BOOKING,
      userId: OWNER,
    });
    expect(options.idempotencyKey).toBe(`payment-flight-${BOOKING}`);

    expect(res.status).toBe(PaymentStatus.PENDING);
    expect(res.amount).toBe(250.5);
    expect(res.clientSecret).toBe('pi_123_secret_x');
  });

  it('never stores the client secret (PAY-01: only id, amount, currency, status)', async () => {
    const { service, model } = setup();
    await service.createPayment(OWNER, 'hotel', BOOKING);
    const saved = model.create.mock.calls[0][0] as Record<string, unknown>;
    expect(saved).not.toHaveProperty('clientSecret');
    expect(saved.stripePaymentIntentId).toBe('pi_123');
  });

  it('checks ownership, payability and policy acceptance before calling Stripe', async () => {
    const { service, stripe, policies } = setup();
    policies.assertAccepted.mockRejectedValue({
      code: ErrorCode.POLICIES_NOT_ACCEPTED,
    });
    expect(await codeOf(service.createPayment(OWNER, 'flight', BOOKING))).toBe(
      ErrorCode.POLICIES_NOT_ACCEPTED,
    );
    expect(policies.getOwnedBooking).toHaveBeenCalledWith(
      OWNER,
      'flight',
      BOOKING,
    );
    expect(policies.assertPayable).toHaveBeenCalled();
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('returns the same pending payment on a second call (no second PaymentIntent)', async () => {
    const existing = {
      id: 'pay_1',
      bookingType: 'flight',
      bookingId: { toString: () => BOOKING },
      status: PaymentStatus.PENDING,
      amountMinor: 25050,
      currency: 'EGP',
      stripePaymentIntentId: 'pi_123',
      holdExpiresAt: HOLD,
      succeededAt: null,
      createdAt: new Date(),
    };
    const { service, stripe } = setup({ existing });
    const res = await service.createPayment(OWNER, 'flight', BOOKING);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    expect(res.id).toBe('pay_1');
    expect(res.clientSecret).toBe('pi_123_secret_x');
  });

  it('409 PAYMENT_ALREADY_EXISTS when the previous attempt failed (use retry)', async () => {
    const { service } = setup({ existing: { status: PaymentStatus.FAILED } });
    expect(await codeOf(service.createPayment(OWNER, 'flight', BOOKING))).toBe(
      ErrorCode.PAYMENT_ALREADY_EXISTS,
    );
  });

  it.each(['XYZ', 'USD'])(
    'PAY-04: rejects %s (not the platform currency)',
    async (currency) => {
      const { service, stripe } = setup({ currency });
      expect(
        await codeOf(service.createPayment(OWNER, 'flight', BOOKING)),
      ).toBe(ErrorCode.UNSUPPORTED_CURRENCY);
      expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    },
  );

  it('503 STRIPE_NOT_CONFIGURED without a Stripe key', async () => {
    const { model, policies } = setup();
    const service = new PaymentsService(
      model as never,
      null,
      policies as never,
    );
    expect(await codeOf(service.createPayment(OWNER, 'flight', BOOKING))).toBe(
      ErrorCode.STRIPE_NOT_CONFIGURED,
    );
  });
});

describe('PaymentsService.retryPayment (PAY-01)', () => {
  function retrySetup(
    status: PaymentStatus,
    intentStatus = 'requires_payment_method',
  ) {
    const { service, stripe, model, policies } = setup();
    const doc = {
      _id: 'pay_1',
      id: 'pay_1',
      bookingType: 'flight',
      bookingId: { toString: () => BOOKING },
      status,
      amountMinor: 25050,
      currency: 'EGP',
      stripePaymentIntentId: 'pi_123',
      holdExpiresAt: HOLD,
      succeededAt: null,
      createdAt: new Date(),
    };
    Object.assign(model, {
      findById: vi.fn().mockReturnValue({ exec: () => Promise.resolve(doc) }),
      updateOne: vi.fn().mockReturnValue({ exec: () => Promise.resolve({}) }),
    });
    stripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_123',
      status: intentStatus,
      client_secret: 'pi_123_secret_x',
    });
    return { service, stripe, model, policies };
  }

  it('reuses the same PaymentIntent and moves failed -> pending', async () => {
    const { service, stripe, model } = retrySetup(PaymentStatus.FAILED);
    const res = await service.retryPayment(OWNER, 'pay_1');
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    expect(
      (model as unknown as { updateOne: ReturnType<typeof vi.fn> }).updateOne
        .mock.calls[0][1],
    ).toEqual({
      status: PaymentStatus.PENDING,
    });
    expect(res.status).toBe(PaymentStatus.PENDING);
    expect(res.clientSecret).toBe('pi_123_secret_x');
  });

  it('checks the booking is still payable (hold not expired)', async () => {
    const { service, policies } = retrySetup(PaymentStatus.FAILED);
    policies.assertPayable.mockImplementation(() => {
      throw { code: ErrorCode.HOLD_EXPIRED };
    });
    expect(await codeOf(service.retryPayment(OWNER, 'pay_1'))).toBe(
      ErrorCode.HOLD_EXPIRED,
    );
  });

  it('409 for a succeeded or cancelled payment', async () => {
    for (const status of [PaymentStatus.SUCCEEDED, PaymentStatus.CANCELLED]) {
      const { service } = retrySetup(status);
      expect(await codeOf(service.retryPayment(OWNER, 'pay_1'))).toBe(
        ErrorCode.PAYMENT_NOT_RETRYABLE,
      );
    }
  });

  it('409 when Stripe says the intent can no longer take a card', async () => {
    const { service } = retrySetup(PaymentStatus.FAILED, 'canceled');
    expect(await codeOf(service.retryPayment(OWNER, 'pay_1'))).toBe(
      ErrorCode.PAYMENT_NOT_RETRYABLE,
    );
  });
});

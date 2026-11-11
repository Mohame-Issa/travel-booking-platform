import { HttpStatus } from '@nestjs/common';
import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { PaymentStatus } from './payments.constants.js';
import { StripeWebhookService } from './stripe-webhook.service.js';

const SECRET = 'whsec_test_secret';
// A real SDK instance: used only to verify/sign locally, no network calls.
const stripe = new Stripe('sk_test_dummy_for_unit_tests');
const BOOKING = '64b0000000000000000000aa';

function signed(type: string, object: Record<string, unknown>, id = 'evt_1') {
  const payload = JSON.stringify({
    id,
    object: 'event',
    type,
    data: { object },
  });
  const header = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: SECRET,
  });
  return { body: Buffer.from(payload), header };
}

function intent(over: Record<string, unknown> = {}) {
  return {
    id: 'pi_123',
    object: 'payment_intent',
    amount_received: 25050,
    currency: 'usd',
    ...over,
  };
}

function setup(paymentOver: Record<string, unknown> | null = {}) {
  const payment =
    paymentOver === null
      ? null
      : {
          _id: 'pay_1',
          id: 'pay_1',
          bookingType: 'flight',
          bookingId: { toString: () => BOOKING },
          amountMinor: 25050,
          currency: 'USD',
          status: PaymentStatus.PENDING,
          ...paymentOver,
        };
  const seen = new Set<string>();
  const eventModel = {
    create: vi.fn().mockImplementation(({ eventId }: { eventId: string }) => {
      if (seen.has(eventId))
        return Promise.reject(Object.assign(new Error('dup'), { code: 11000 }));
      seen.add(eventId);
      return Promise.resolve({});
    }),
    deleteOne: vi
      .fn()
      .mockImplementation(({ eventId }: { eventId: string }) => {
        seen.delete(eventId);
        return { exec: () => Promise.resolve({}) };
      }),
  };
  const paymentModel = {
    findOne: vi.fn().mockReturnValue({ exec: () => Promise.resolve(payment) }),
    updateOne: vi.fn().mockReturnValue({ exec: () => Promise.resolve({}) }),
  };
  const flights = {
    confirmBooking: vi.fn().mockResolvedValue(undefined),
    releaseInventory: vi.fn(),
  };
  const hotels = {
    confirmBooking: vi.fn().mockResolvedValue(undefined),
    releaseInventory: vi.fn(),
  };
  const payments = { stripe: () => stripe };
  const config = { get: () => SECRET };
  const service = new StripeWebhookService(
    paymentModel as never,
    eventModel as never,
    flights,
    hotels,
    payments as never,
    config as never,
  );
  return { service, paymentModel, eventModel, flights, hotels };
}

describe('StripeWebhookService (PAY-01)', () => {
  it('rejects a bad signature with 400 and confirms nothing', async () => {
    const { service, flights } = setup();
    const { body } = signed('payment_intent.succeeded', intent());
    const err = await service
      .handle(body, 't=1,v1=forged')
      .catch((e: ApiException) => e);
    expect((err as ApiException).code).toBe(
      ErrorCode.INVALID_WEBHOOK_SIGNATURE,
    );
    expect((err as ApiException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(flights.confirmBooking).not.toHaveBeenCalled();
  });

  it('rejects a body modified after signing', async () => {
    const { service } = setup();
    const { header } = signed('payment_intent.succeeded', intent());
    const tampered = Buffer.from(
      JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' }),
    );
    await expect(service.handle(tampered, header)).rejects.toMatchObject({
      code: ErrorCode.INVALID_WEBHOOK_SIGNATURE,
    });
  });

  it('succeeded: marks the payment succeeded and confirms the booking', async () => {
    const { service, paymentModel, flights } = setup();
    const { body, header } = signed('payment_intent.succeeded', intent());
    expect(await service.handle(body, header)).toEqual({ received: true });
    expect(paymentModel.updateOne.mock.calls[0][1]).toMatchObject({
      status: PaymentStatus.SUCCEEDED,
    });
    expect(flights.confirmBooking).toHaveBeenCalledWith({
      bookingId: BOOKING,
      paymentId: 'pay_1',
    });
  });

  it('a replayed event is skipped (no double confirmation)', async () => {
    const { service, flights } = setup();
    const { body, header } = signed('payment_intent.succeeded', intent());
    await service.handle(body, header);
    expect(await service.handle(body, header)).toEqual({
      received: true,
      duplicate: true,
    });
    expect(flights.confirmBooking).toHaveBeenCalledTimes(1);
  });

  it('does not confirm when Stripe received a different amount', async () => {
    const { service, flights } = setup();
    const { body, header } = signed(
      'payment_intent.succeeded',
      intent({ amount_received: 100 }),
    );
    await service.handle(body, header);
    expect(flights.confirmBooking).not.toHaveBeenCalled();
  });

  it('does not confirm a payment whose hold already expired (GEN-11)', async () => {
    const { service, hotels } = setup({
      bookingType: 'hotel',
      status: PaymentStatus.CANCELLED,
    });
    const { body, header } = signed('payment_intent.succeeded', intent());
    await service.handle(body, header);
    expect(hotels.confirmBooking).not.toHaveBeenCalled();
  });

  it('payment_failed: marks failed, keeps the hold (user may retry), releases nothing', async () => {
    const { service, paymentModel, flights } = setup();
    const { body, header } = signed('payment_intent.payment_failed', intent());
    await service.handle(body, header);
    expect(paymentModel.updateOne.mock.calls[0][1]).toEqual({
      status: PaymentStatus.FAILED,
    });
    expect(flights.releaseInventory).not.toHaveBeenCalled();
    expect(flights.confirmBooking).not.toHaveBeenCalled();
  });

  it('ignores PaymentIntents we did not create (e.g. stripe trigger)', async () => {
    const { service, paymentModel } = setup(null);
    const { body, header } = signed('payment_intent.succeeded', intent());
    expect(await service.handle(body, header)).toEqual({ received: true });
    expect(paymentModel.updateOne).not.toHaveBeenCalled();
  });

  it('on a temporary error the event is forgotten so Stripe can retry it', async () => {
    const { service, flights, eventModel } = setup();
    flights.confirmBooking.mockRejectedValueOnce(new Error('database down'));
    const { body, header } = signed('payment_intent.succeeded', intent());
    await expect(service.handle(body, header)).rejects.toThrow('database down');
    expect(eventModel.deleteOne).toHaveBeenCalledWith({ eventId: 'evt_1' });
    // Stripe retries: now it goes through.
    expect(await service.handle(body, header)).toEqual({ received: true });
    expect(flights.confirmBooking).toHaveBeenCalledTimes(2);
  });
});

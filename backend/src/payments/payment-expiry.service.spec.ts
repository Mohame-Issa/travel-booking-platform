import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { PaymentExpiryService } from './payment-expiry.service.js';
import { PaymentStatus } from './payments.constants.js';

const BOOKING = '64b0000000000000000000aa';

function payment(over: Record<string, unknown> = {}) {
  return {
    _id: 'pay_1',
    id: 'pay_1',
    bookingType: 'flight',
    bookingId: { toString: () => BOOKING },
    stripePaymentIntentId: 'pi_123',
    status: PaymentStatus.PENDING,
    releasedAt: null,
    ...over,
  };
}

function setup(due: Record<string, unknown>[], modifiedCount = 1) {
  const paymentModel = {
    find: vi.fn().mockReturnValue({ exec: () => Promise.resolve(due) }),
    updateOne: vi
      .fn()
      .mockReturnValue({ exec: () => Promise.resolve({ modifiedCount }) }),
  };
  const stripe = {
    paymentIntents: {
      cancel: vi.fn().mockResolvedValue({ status: 'canceled' }),
      retrieve: vi.fn(),
    },
  };
  const flights = {
    confirmBooking: vi.fn(),
    releaseInventory: vi.fn().mockResolvedValue(undefined),
  };
  const hotels = {
    confirmBooking: vi.fn(),
    releaseInventory: vi.fn().mockResolvedValue(undefined),
  };
  const service = new PaymentExpiryService(
    paymentModel as never,
    stripe as never,
    flights,
    hotels,
  );
  return { service, paymentModel, stripe, flights, hotels };
}

function unexpectedState(): Error {
  return new Stripe.errors.StripeInvalidRequestError({
    code: 'payment_intent_unexpected_state',
    message: 'cannot cancel',
    type: 'invalid_request_error',
  });
}

describe('PaymentExpiryService (PAY-01: hold expiry)', () => {
  it('cancels the PaymentIntent, marks the payment cancelled and releases inventory', async () => {
    const { service, stripe, paymentModel, flights } = setup([payment()]);
    await service.runOnce();
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith('pi_123');
    expect(paymentModel.updateOne.mock.calls[0][1]).toEqual({
      status: PaymentStatus.CANCELLED,
    });
    expect(flights.releaseInventory).toHaveBeenCalledWith({
      bookingId: BOOKING,
      reason: 'payment_expired',
    });
    expect(paymentModel.updateOne.mock.calls[1][1]).toHaveProperty(
      'releasedAt',
    );
  });

  it('uses reason payment_failed when the last attempt failed', async () => {
    const { service, hotels } = setup([
      payment({ bookingType: 'hotel', status: PaymentStatus.FAILED }),
    ]);
    await service.runOnce();
    expect(hotels.releaseInventory).toHaveBeenCalledWith({
      bookingId: BOOKING,
      reason: 'payment_failed',
    });
  });

  it('does nothing if the PaymentIntent succeeded at the last second (webhook decides)', async () => {
    const { service, stripe, flights, paymentModel } = setup([payment()]);
    stripe.paymentIntents.cancel.mockRejectedValue(unexpectedState());
    stripe.paymentIntents.retrieve.mockResolvedValue({ status: 'succeeded' });
    await service.runOnce();
    expect(paymentModel.updateOne).not.toHaveBeenCalled();
    expect(flights.releaseInventory).not.toHaveBeenCalled();
  });

  it('does not release if the payment changed meanwhile (atomic status check)', async () => {
    const { service, flights } = setup([payment()], 0);
    await service.runOnce();
    expect(flights.releaseInventory).not.toHaveBeenCalled();
  });

  it('retries the release next run if it failed (cancelled, releasedAt null)', async () => {
    const { service, stripe, flights } = setup([
      payment({ status: PaymentStatus.CANCELLED }),
    ]);
    await service.runOnce();
    expect(stripe.paymentIntents.cancel).not.toHaveBeenCalled();
    expect(flights.releaseInventory).toHaveBeenCalledTimes(1);
  });

  it('one failing payment does not stop the others', async () => {
    const { service, flights } = setup([
      payment(),
      payment({ _id: 'pay_2', id: 'pay_2' }),
    ]);
    flights.releaseInventory.mockRejectedValueOnce(
      new Error('placeholder 501'),
    );
    await service.runOnce();
    expect(flights.releaseInventory).toHaveBeenCalledTimes(2);
  });

  it('is disabled without a Stripe key', async () => {
    const { paymentModel, flights, hotels } = setup([payment()]);
    const service = new PaymentExpiryService(
      paymentModel as never,
      null,
      flights,
      hotels,
    );
    await service.runOnce();
    expect(paymentModel.find).not.toHaveBeenCalled();
  });
});

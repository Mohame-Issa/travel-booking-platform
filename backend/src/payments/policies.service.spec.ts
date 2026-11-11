import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { BookingStatus } from '../common/interfaces/index.js';
import type {
  BookingPaymentReader,
  BookingPaymentSnapshot,
} from './booking-payment-reader.js';
import { PoliciesService } from './policies.service.js';

const OWNER = '64b000000000000000000001';
const OTHER = '64b000000000000000000002';
const BOOKING = '64b0000000000000000000aa';

function booking(
  over: Partial<BookingPaymentSnapshot> = {},
): BookingPaymentSnapshot {
  return {
    bookingId: BOOKING,
    userId: OWNER,
    status: BookingStatus.PENDING_PAYMENT,
    totalAmount: 250.5,
    currency: 'USD',
    holdExpiresAt: new Date(Date.now() + 5 * 60_000),
    startsAt: new Date(Date.now() + 30 * 86_400_000),
    policies: {
      cancellationTiers: [
        { daysBefore: 7, refundPercentage: 50 },
        { daysBefore: 30, refundPercentage: 100 },
      ],
      baggagePolicy: {
        freeBags: 1,
        maxWeightKgPerBag: 23,
        extraBagPrice: 40,
        maxExtraBags: 2,
      },
      checkInTime: null,
      checkOutTime: null,
    },
    ...over,
  };
}

function setup(
  snapshot: BookingPaymentSnapshot | null,
  existing: unknown = null,
) {
  const reader: BookingPaymentReader = {
    getPaymentSnapshot: vi.fn().mockResolvedValue(snapshot),
  };
  const model = {
    findOne: vi
      .fn()
      .mockReturnValue({ exec: vi.fn().mockResolvedValue(existing) }),
    create: vi
      .fn()
      .mockImplementation((doc: Record<string, unknown>) =>
        Promise.resolve(doc),
      ),
  };
  const service = new PoliciesService(model as never, reader, reader);
  return { service, model };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as ApiException).code;
  }
  return 'NO_ERROR';
}

describe('PoliciesService (PAY-02)', () => {
  it('returns sorted tiers and accepted=false before acceptance', async () => {
    const { service } = setup(booking());
    const res = await service.getPolicies(OWNER, 'flight', BOOKING);
    expect(res.accepted).toBe(false);
    expect(res.cancellationTiers.map((t) => t.daysBefore)).toEqual([7, 30]);
  });

  it('404 when the booking does not exist', async () => {
    const { service } = setup(null);
    expect(await codeOf(service.getPolicies(OWNER, 'hotel', BOOKING))).toBe(
      ErrorCode.NOT_FOUND,
    );
  });

  it('403 when the booking belongs to someone else (ACC-11)', async () => {
    const { service } = setup(booking());
    expect(await codeOf(service.getPolicies(OTHER, 'flight', BOOKING))).toBe(
      ErrorCode.NOT_RESOURCE_OWNER,
    );
  });

  it('stores acceptance with a timestamp and a policy snapshot', async () => {
    const { service, model } = setup(booking());
    const res = await service.acceptPolicies(OWNER, 'flight', BOOKING);
    expect(res.accepted).toBe(true);
    expect(res.acceptedAt).toBeInstanceOf(Date);
    const saved = model.create.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.cancellationTiers).toHaveLength(2);
  });

  it('is idempotent: a second accept keeps the first timestamp', async () => {
    const first = {
      ...booking().policies,
      acceptedAt: new Date('2026-11-11T10:00:00Z'),
    };
    const { service, model } = setup(booking(), first);
    const res = await service.acceptPolicies(OWNER, 'flight', BOOKING);
    expect(res.acceptedAt).toEqual(first.acceptedAt);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('409 BOOKING_NOT_PAYABLE when not Pending Payment (GEN-11)', async () => {
    const { service } = setup(booking({ status: BookingStatus.CONFIRMED }));
    expect(await codeOf(service.acceptPolicies(OWNER, 'flight', BOOKING))).toBe(
      ErrorCode.BOOKING_NOT_PAYABLE,
    );
  });

  it('409 HOLD_EXPIRED after the 10-minute hold (FLT-22 / HTL-18)', async () => {
    const { service } = setup(
      booking({ holdExpiresAt: new Date(Date.now() - 1000) }),
    );
    expect(await codeOf(service.acceptPolicies(OWNER, 'hotel', BOOKING))).toBe(
      ErrorCode.HOLD_EXPIRED,
    );
  });

  it('assertAccepted blocks payment until accepted', async () => {
    const { service } = setup(booking());
    expect(await codeOf(service.assertAccepted('flight', BOOKING))).toBe(
      ErrorCode.POLICIES_NOT_ACCEPTED,
    );
  });
});

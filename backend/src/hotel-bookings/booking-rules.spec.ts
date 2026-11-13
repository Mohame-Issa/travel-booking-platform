import { describe, expect, it } from 'vitest';
import { BookingStatus } from '../common/interfaces/index.js';
import {
  BookingGroup,
  groupFilter,
  isOccupied,
  parseStay,
  stayTotal,
  validateGuests,
} from './booking-rules.js';
import { RoomAvailabilityKind } from '../hotels/schemas/room-availability.schema.js';

const NOW = new Date('2026-11-13T15:00:00Z');
const fail = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { getResponse(): { message: string } }).getResponse().message;
  }
  throw new Error('expected a rejection');
};

describe('parseStay (HTL-18 dates)', () => {
  it('accepts today (UTC) and counts nights with an exclusive check-out', () => {
    expect(parseStay('2026-11-13', '2026-11-16', NOW)).toMatchObject({
      nights: 3,
    });
  });
  it('rejects a past check-in and a check-out not after check-in', () => {
    expect(fail(() => parseStay('2026-11-12', '2026-11-14', NOW))).toMatch(
      /past/,
    );
    expect(fail(() => parseStay('2026-11-14', '2026-11-14', NOW))).toMatch(
      /after/,
    );
  });
});

describe('validateGuests (HTL-16)', () => {
  const rooms = new Map([
    ['a', { maxOccupancy: 2 }],
    ['b', { maxOccupancy: 3 }],
  ]);
  it('accepts children-only rooms when the reservation has an adult', () => {
    expect(() =>
      validateGuests(
        [
          { roomId: 'a', adults: 1, childrenAges: [4] },
          { roomId: 'b', adults: 0, childrenAges: [10, 12] },
        ],
        rooms,
      ),
    ).not.toThrow();
  });
  it('treats a null childrenAges as no children instead of crashing', () => {
    expect(() =>
      validateGuests(
        [{ roomId: 'a', adults: 2, childrenAges: null as never }],
        rooms,
      ),
    ).not.toThrow();
  });
  it('requires an adult, unique rooms and occupancy within each room', () => {
    expect(
      fail(() =>
        validateGuests([{ roomId: 'a', adults: 0, childrenAges: [3] }], rooms),
      ),
    ).toMatch(/adult/);
    expect(
      fail(() =>
        validateGuests(
          [
            { roomId: 'a', adults: 1, childrenAges: [] },
            { roomId: 'a', adults: 1, childrenAges: [] },
          ],
          rooms,
        ),
      ),
    ).toMatch(/once/);
    expect(
      fail(() =>
        validateGuests([{ roomId: 'a', adults: 2, childrenAges: [1] }], rooms),
      ),
    ).toMatch(/occupancy/);
  });
});

describe('stayTotal (HTL-16)', () => {
  it('sums nights x price per room without float artifacts', () => {
    expect(stayTotal([0.1, 0.2], 3)).toBe(0.9);
    expect(stayTotal([1200, 850.5], 2)).toBe(4101);
  });
});

describe('isOccupied (HTL-06/18 conflicts)', () => {
  const row = (
    kind: RoomAvailabilityKind,
    holdExpiresAt: Date | null = null,
    bookingId: string | null = null,
  ) => ({ kind, holdExpiresAt, bookingId }) as never;
  it('counts confirmed rows and unexpired holds, never expired holds, availability or the own booking', () => {
    expect(isOccupied(row(RoomAvailabilityKind.BOOKED), NOW)).toBe(true);
    expect(
      isOccupied(row(RoomAvailabilityKind.HELD, new Date(+NOW + 1)), NOW),
    ).toBe(true);
    expect(
      isOccupied(row(RoomAvailabilityKind.HELD, new Date(+NOW - 1)), NOW),
    ).toBe(false);
    expect(isOccupied(row(RoomAvailabilityKind.AVAILABLE), NOW)).toBe(false);
    expect(
      isOccupied(row(RoomAvailabilityKind.BOOKED, null, 'mine'), NOW, 'mine'),
    ).toBe(false);
  });
});

describe('groupFilter (HTL-20)', () => {
  it('maps Upcoming, Past and Cancelled onto lifecycle states', () => {
    expect(groupFilter(BookingGroup.CANCELLED, NOW)).toEqual({
      status: BookingStatus.CANCELLED,
    });
    expect(groupFilter(BookingGroup.UPCOMING, NOW)).toEqual({
      status: { $in: [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED] },
      checkOutDate: { $gt: NOW },
    });
    expect(groupFilter(undefined, NOW)).toEqual({});
  });
});

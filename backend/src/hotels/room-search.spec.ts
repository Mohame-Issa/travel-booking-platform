import { qualifyingRooms, roomIsFree } from './room-search.js';
import {
  RoomAvailabilityKind as Kind,
  type RoomAvailability,
} from './schemas/room-availability.schema.js';
const day = (n: number) =>
  new Date(`2099-12-${String(n).padStart(2, '0')}T00:00:00Z`);
const range = (
  start: number,
  end: number,
  kind = Kind.AVAILABLE,
  expiry: Date | null = null,
): RoomAvailability => ({
  roomId: 'room' as never,
  startDate: day(start),
  endDate: day(end),
  kind,
  holdExpiresAt: expiry,
  bookingId: null,
});
describe('Hotel whole-stay availability (HTL-11, HTL-18)', () => {
  it('covers every night across adjacent ranges, rejecting gaps', () => {
    expect(roomIsFree([range(1, 2), range(2, 4)], day(1), day(4))).toBe(true);
    expect(roomIsFree([range(1, 2), range(3, 4)], day(1), day(4))).toBe(false);
    expect(roomIsFree([], day(1), day(4))).toBe(false);
  });
  it('excludes blocked intervals, confirmed stays and unexpired holds', () => {
    for (const kind of [Kind.BLOCKED, Kind.BOOKED, Kind.HELD])
      expect(
        roomIsFree(
          [range(1, 10), range(2, 3, kind, day(8))],
          day(1),
          day(4),
          day(1),
        ),
      ).toBe(false);
  });
  it('allows checkout/check-in adjacency and ignores expired holds', () => {
    expect(
      roomIsFree([range(1, 10), range(1, 2, Kind.BOOKED)], day(2), day(4)),
    ).toBe(true);
    expect(
      roomIsFree(
        [range(1, 10), range(2, 3, Kind.HELD, day(1))],
        day(2),
        day(4),
        day(1),
      ),
    ).toBe(true);
  });
  it('excludes a hold with missing expiry conservatively', () => {
    expect(
      roomIsFree(
        [range(1, 10), range(2, 3, Kind.HELD)],
        day(1),
        day(4),
        day(1),
      ),
    ).toBe(false);
  });
});
describe('Room count, capacity and qualifying prices (HTL-11/12)', () => {
  const single = { maxOccupancy: 1, price: 10 },
    double = { maxOccupancy: 2, price: 100 },
    suite = { maxOccupancy: 4, price: 300 };
  it('excludes a cheap room that cannot participate in the requested occupancy', () => {
    expect(qualifyingRooms([single, double, suite], 1, 2)).toEqual([
      double,
      suite,
    ]);
  });
  it('checks combined occupancy of exactly the requested room count', () => {
    expect(qualifyingRooms([single, double, suite], 2, 6)).toEqual([
      double,
      suite,
    ]);
    expect(qualifyingRooms([single, double, suite], 2, 7)).toEqual([]);
    expect(qualifyingRooms([suite], 2, 2)).toEqual([]);
  });
});

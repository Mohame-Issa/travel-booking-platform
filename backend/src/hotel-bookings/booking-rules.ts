import { randomBytes } from 'node:crypto';
import { BookingStatus } from '../common/interfaces/index.js';
import {
  dateOnly,
  invalid,
  quoteAmount,
} from '../flights/catalogue-validation.js';
import {
  RoomAvailabilityKind,
  type RoomAvailability,
} from '../hotels/schemas/room-availability.schema.js';

/** HTL-18: all selected rooms are held together for 10 minutes. */
export const HOLD_MS = 10 * 60_000;
const DAY_MS = 86_400_000;

export enum BookingGroup {
  UPCOMING = 'upcoming',
  PAST = 'past',
  CANCELLED = 'cancelled',
}

export interface RoomRequest {
  roomId: string;
  adults: number;
  childrenAges: number[];
}

/** HTL-18: UTC-midnight [checkIn, checkOut); check-in not in the past (UTC today, as hotel search). */
export function parseStay(
  checkInDate: string,
  checkOutDate: string,
  now = new Date(),
) {
  const start = dateOnly(checkInDate);
  const end = dateOnly(checkOutDate);
  if (checkInDate < now.toISOString().slice(0, 10))
    invalid('Check-in date cannot be in the past (HTL-18)', 'checkInDate');
  if (end <= start)
    invalid('Check-out must be after check-in (HTL-18)', 'checkOutDate');
  return { start, end, nights: (+end - +start) / DAY_MS };
}

/** HTL-16: unique rooms, at least one adult per reservation, no room above its maximum occupancy. */
export function validateGuests(
  requests: RoomRequest[],
  rooms: Map<string, { maxOccupancy: number; roomNumber?: string }>,
) {
  if (new Set(requests.map((r) => r.roomId)).size !== requests.length)
    invalid('Each room can be selected only once', 'rooms');
  if (!requests.some((r) => r.adults >= 1))
    invalid('A reservation needs at least one adult (HTL-16)', 'rooms');
  for (const r of requests) {
    const room = rooms.get(r.roomId);
    if (room && r.adults + (r.childrenAges ?? []).length > room.maxOccupancy)
      invalid(
        `Room ${room.roomNumber ?? r.roomId} exceeds its maximum occupancy of ${room.maxOccupancy} (HTL-16)`,
        'rooms',
      );
  }
}

/** HTL-16: sum over rooms of nights x that room's price at booking time. */
export function stayTotal(pricesPerNight: number[], nights: number): number {
  const sum = pricesPerNight.reduce(
    (total, price) => total + quoteAmount(price, nights),
    0,
  );
  return Number(sum.toFixed(6)); // drops float artifacts only; payments owns minor-unit rules
}

/** A row that makes its dates unavailable to other reservations (HTL-06, HTL-18). */
export function isOccupied(
  row: Pick<RoomAvailability, 'kind' | 'holdExpiresAt' | 'bookingId'>,
  now: Date,
  ownBookingId?: string,
): boolean {
  if (ownBookingId && row.bookingId && String(row.bookingId) === ownBookingId)
    return false;
  if (row.kind === RoomAvailabilityKind.BOOKED) return true;
  // A hold without expiry is treated as occupied, like hotel search does.
  return (
    row.kind === RoomAvailabilityKind.HELD &&
    (!row.holdExpiresAt || row.holdExpiresAt > now)
  );
}

/** HTL-20 groups. Expired reservations count as Past. */
export function groupFilter(group: BookingGroup | undefined, now: Date) {
  const active = [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED];
  switch (group) {
    case BookingGroup.UPCOMING:
      return { status: { $in: active }, checkOutDate: { $gt: now } };
    case BookingGroup.PAST:
      return {
        $or: [
          { status: { $in: [BookingStatus.COMPLETED, BookingStatus.EXPIRED] } },
          { status: { $in: active }, checkOutDate: { $lte: now } },
        ],
      };
    case BookingGroup.CANCELLED:
      return { status: BookingStatus.CANCELLED };
    default:
      return {};
  }
}

/** HTL-17: unique booking reference, issued at confirmation (unique index backs it). */
export function newReference(): string {
  return `HB-${randomBytes(5).toString('hex').toUpperCase()}`;
}

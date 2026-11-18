import type { RoomAvailability } from './schemas/room-availability.schema.js';
import { RoomAvailabilityKind } from './schemas/room-availability.schema.js';

export function roomIsFree(
  ranges: RoomAvailability[],
  start: Date,
  end: Date,
  now = new Date(),
): boolean {
  // HTL-11/18: half-open ranges allow a new stay on the previous checkout date.
  const overlapping = ranges.filter(
    (range) => range.startDate < end && range.endDate > start,
  );
  if (
    overlapping.some(
      (range) =>
        range.kind === RoomAvailabilityKind.BLOCKED ||
        range.kind === RoomAvailabilityKind.BOOKED ||
        (range.kind === RoomAvailabilityKind.HELD &&
          (!range.holdExpiresAt || range.holdExpiresAt > now)),
    )
  )
    return false;
  const bookable = overlapping
    .filter((range) => range.kind === RoomAvailabilityKind.AVAILABLE)
    .sort((a, b) => +a.startDate - +b.startDate);
  let coveredThrough = +start;
  for (const range of bookable) {
    if (+range.startDate > coveredThrough) return false;
    coveredThrough = Math.max(coveredThrough, +range.endDate);
    if (coveredThrough >= +end) return true;
  }
  return false;
}
export function qualifyingRooms<T extends { maxOccupancy: number }>(
  rooms: T[],
  requestedRooms: number,
  guests: number,
): T[] {
  // HTL-11/12: price only rooms that can participate in a qualifying selection.
  if (rooms.length < requestedRooms) return [];
  const capacity = [...rooms].sort((a, b) => b.maxOccupancy - a.maxOccupancy);
  if (
    capacity
      .slice(0, requestedRooms)
      .reduce((sum, room) => sum + room.maxOccupancy, 0) < guests
  )
    return [];
  return rooms.filter(
    (room) =>
      room.maxOccupancy +
        capacity
          .filter((other) => other !== room)
          .slice(0, requestedRooms - 1)
          .reduce((sum, other) => sum + other.maxOccupancy, 0) >=
      guests,
  );
}

/**
 * FLT-28 (bonus): seat numbers of a cabin. The requirement only says "allow
 * seat selection", so the layout is our assumption (agreed with Youssef):
 * each cabin is numbered on its own, in rows of 6 seats A-F, from row 1.
 * A cabin with seatCount 20 has seats 1A..1F, 2A..2F, 3A..3F, 4A, 4B.
 * Nothing is stored for the layout: it follows from the cabin's seat count
 * (Yassin's CabinInventory), so it can never disagree with it.
 */
export const SEAT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export const SEATS_PER_ROW = SEAT_LETTERS.length;

/** "12C" -> 12th row, 3rd letter. Format check only (the DTO uses it too). */
export const SEAT_NUMBER_PATTERN = /^[1-9][0-9]{0,2}[A-F]$/;

/** All seat numbers of a cabin, in order. */
export function seatNumbers(seatCount: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < seatCount; i++) out.push(seatAt(i));
  return out;
}

/** Position 0 -> "1A", 6 -> "2A". */
export function seatAt(index: number): string {
  const row = Math.floor(index / SEATS_PER_ROW) + 1;
  return `${row}${SEAT_LETTERS[index % SEATS_PER_ROW]}`;
}

/** "2A" -> 6. -1 if the text is not a seat number. */
export function seatIndex(seat: string): number {
  const s = seat.trim().toUpperCase();
  if (!SEAT_NUMBER_PATTERN.test(s)) return -1;
  const row = Number(s.slice(0, -1));
  const col = SEAT_LETTERS.indexOf(
    s.slice(-1) as (typeof SEAT_LETTERS)[number],
  );
  return (row - 1) * SEATS_PER_ROW + col;
}

/** True if the seat exists in a cabin of this size. */
export function isSeatInCabin(seat: string, seatCount: number): boolean {
  const i = seatIndex(seat);
  return i >= 0 && i < seatCount;
}

/**
 * Picks the first free seats in order, skipping `taken`. Returns fewer than
 * `count` if the cabin is full (the caller treats that as no availability).
 */
export function firstFreeSeats(
  seatCount: number,
  taken: Set<string>,
  count: number,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < seatCount && out.length < count; i++) {
    const s = seatAt(i);
    if (!taken.has(s)) out.push(s);
  }
  return out;
}

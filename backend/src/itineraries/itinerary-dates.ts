/**
 * Date helpers for itineraries. Dates are calendar days, stored as UTC
 * midnight and shown as "YYYY-MM-DD", so time zones can never shift a day.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-12-01" -> Date at 2026-12-01T00:00:00Z. Returns null if not a real date. */
export function parseIsoDate(value: string): Date | null {
  if (!ISO_DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  // Rejects impossible dates such as 2026-02-30 (JS would roll them over).
  return Number.isNaN(date.getTime()) || toIsoDate(date) !== value
    ? null
    : date;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** ITN-05: day N is on startDate + (N - 1) days. */
export function dayDate(startDate: Date, dayNumber: number): string {
  return toIsoDate(
    new Date(startDate.getTime() + (dayNumber - 1) * MS_PER_DAY),
  );
}

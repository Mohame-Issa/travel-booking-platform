import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** FLT-23: unique reference like FB-K7M2QX (uniqueness also enforced by a DB index). */
export function generateBookingReference(): string {
  const bytes = randomBytes(6);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `FB-${out}`;
}

export const round2 = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;

/** GEN-06: show a UTC date in an airport's local time zone. */
export function formatLocal(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} (${timeZone})`;
}

/** CSV cell with quote escaping and spreadsheet-formula protection. */
export type CsvValue = string | number | boolean | Date | null | undefined;

export function csvCell(value: CsvValue): string {
  let s =
    value === null || value === undefined
      ? ''
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows: CsvValue[][]): string =>
  rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

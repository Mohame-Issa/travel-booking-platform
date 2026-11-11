import { applyDecorators, HttpStatus } from '@nestjs/common';
import { IsISO8601, Matches, ValidateIf } from 'class-validator';
import { ApiException } from '../common/exceptions/api.exception.js';
import { ErrorCode } from '../common/constants/error-codes.js';
import { PAGE_SIZE } from '../common/constants/pagination.js';

export const Optional = () =>
  ValidateIf((_object, value) => value !== undefined);
export const IsDateOnly = () =>
  applyDecorators(IsISO8601({ strict: true }), Matches(/^\d{4}-\d{2}-\d{2}$/));
export const IsLocalDateTime = () =>
  applyDecorators(
    IsISO8601({ strict: true }),
    Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2})?$/),
  );

export function invalid(message: string, field?: string): never {
  throw new ApiException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_FAILED,
    message,
    field ? [{ field, messages: [message] }] : undefined,
  );
}

export function conflict(message: string): never {
  throw new ApiException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, message);
}

export function dateOnly(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(+date) ||
    date.toISOString().slice(0, 10) !== value
  )
    invalid('Invalid calendar date');
  return date;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, format);
  }
  return format;
}

/** GEN-06: format in the airport's zone, never in the host machine's zone. */
export function localDateTime(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** FLT-03: match local wall time to UTC; reject DST gaps and require an offset for folds. */
export function localToUtc(value: string, timeZone: string): Date {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?)([+-]\d{2}:\d{2})?$/.exec(value);
  if (!match)
    invalid(
      'Use airport-local YYYY-MM-DDTHH:mm[:ss] with an optional matching UTC offset',
    );
  const wallTime = match[1],
    offset = match[3];
  const normalized = wallTime.length === 16 ? `${wallTime}:00` : wallTime;
  const utc = new Date(`${normalized}Z`);
  if (!Number.isFinite(+utc) || utc.toISOString().slice(0, 19) !== normalized)
    invalid('Invalid local calendar date-time');
  if (offset) {
    const explicit = new Date(`${normalized}${offset}`);
    if (
      !Number.isFinite(+explicit) ||
      localDateTime(explicit, timeZone) !== normalized
    )
      invalid(
        'UTC offset does not match the airport time zone for this local date-time',
      );
    return explicit;
  }
  const offsets = new Set<number>();
  // Inspect both sides of a possible DST transition around this date.
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = new Date(+utc + hours * 3_600_000);
    offsets.add(+new Date(`${localDateTime(sample, timeZone)}Z`) - +sample);
  }
  const matches = [...offsets]
    .map((offset) => new Date(+utc - offset))
    .filter((candidate) => localDateTime(candidate, timeZone) === normalized);
  if (matches.length !== 1)
    invalid(
      'Local time is nonexistent or ambiguous in the airport time zone; include a valid UTC offset to disambiguate a repeated time',
    );
  return matches[0];
}

export function validatePriceRange(min?: number, max?: number): void {
  if (min !== undefined && max !== undefined && min > max)
    invalid('minPrice must not exceed maxPrice', 'minPrice');
}

/** Technical numeric bounds, not a business passenger/page limit (GEN-13). */
export function validatePage(page: number): void {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger((page - 1) * PAGE_SIZE)
  )
    invalid(
      'page must produce a safely representable pagination offset',
      'page',
    );
}

/** Preserve the decimal fare supplied by the provider; payment owns currency minor-unit rules. */
export function quoteAmount(
  unitPrice: number,
  units: number,
  infants = 0,
): number {
  if (!Number.isFinite(unitPrice) || unitPrice <= 0)
    invalid('Price must be a finite positive number', 'price');
  if (
    ![units, infants].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  )
    invalid('Counts must be safely representable nonnegative integers');
  const [significand, power = '0'] = unitPrice
    .toString()
    .toLowerCase()
    .split('e');
  const fractionDigits = significand.split('.')[1]?.length ?? 0;
  const numerator =
    BigInt(significand.replace('.', '')) *
    (BigInt(units) * 10n + BigInt(infants));
  const amount = Number(`${numerator}e${Number(power) - fractionDigits - 1}`);
  if (!Number.isFinite(amount) || (numerator > 0n && amount === 0))
    invalid('Quoted amount is outside the supported numeric range', 'price');
  return amount;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

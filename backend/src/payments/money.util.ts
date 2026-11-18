/**
 * Money helpers. Payments and refunds store amounts in MINOR units (cents,
 * piastres, ...) as integers, because that is what Stripe expects and it
 * avoids floating-point errors (0.1 + 0.2 !== 0.3).
 *
 * Booking totals from the flight/hotel modules are in major units
 * (e.g. 250.5 USD), so we convert at the boundary.
 */

/**
 * Stripe "zero-decimal" currencies among our SUPPORTED_CURRENCIES:
 * the amount is already in the smallest unit (1 JPY = 1, not 100).
 */
const ZERO_DECIMAL_CURRENCIES = new Set(['JPY']);

function factor(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100;
}

/** 250.5 USD -> 25050. Rounds to the nearest minor unit. */
export function toMinorUnits(amount: number, currency: string): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid money amount: ${amount}`);
  }
  return Math.round(amount * factor(currency));
}

/** 25050 USD -> 250.5 */
export function fromMinorUnits(amountMinor: number, currency: string): number {
  return amountMinor / factor(currency);
}

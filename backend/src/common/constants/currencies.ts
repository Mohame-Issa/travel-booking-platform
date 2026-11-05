/**
 * Supported currencies: the distinct `currency` values in
 * docs/requirements/Countries.csv (project description, section 5.1).
 * A unit test (currencies.spec.ts) fails if this list and the CSV drift apart.
 */
export const SUPPORTED_CURRENCIES = [
  'AED',
  'EGP',
  'EUR',
  'GBP',
  'JPY',
  'SAR',
  'USD',
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

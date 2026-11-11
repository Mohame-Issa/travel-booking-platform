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

/**
 * PAY-04: all flight and hotel prices, payments and refunds use a single
 * platform currency. Chosen by the team leader (Mohamed Amr) on 2026-11-11;
 * EGP matches the seeded providers. SUPPORTED_CURRENCIES is still used for a
 * user's preferred display currency in itineraries (ITN-18).
 */
export const PLATFORM_CURRENCY: CurrencyCode = 'EGP';

import { SUPPORTED_CURRENCIES } from '../common/constants/currencies.js';
import {
  loadReferenceData,
  validateReferenceData,
  type ReferenceData,
} from './reference-data.js';
import { validateSeedOptions } from './seed-options.js';

let official: ReferenceData;
beforeAll(async () => {
  official = await loadReferenceData(
    new URL('../../../docs/requirements/', import.meta.url),
  );
});

describe('Official reference data integrity (FLT-02, GEN-12)', () => {
  it('keeps original identifiers, relations and airport zones', () => {
    expect(
      official.airports.find((airport) => airport.iata_code === 'CAI'),
    ).toEqual({
      iata_code: 'CAI',
      name: 'Cairo International Airport',
      city_id: 'cairo',
      country_code: 'EG',
      time_zone: 'Africa/Cairo',
    });
    expect(
      official.attractions.some(
        (attraction) => attraction.attraction_id === 'att-1',
      ),
    ).toBe(true);
    expect(
      [
        ...new Set(official.countries.map((country) => country.currency)),
      ].sort(),
    ).toEqual([...SUPPORTED_CURRENCIES].sort());
    expect(() => validateReferenceData(official)).not.toThrow();
  });
  it.each(['countries', 'cities', 'airports', 'attractions'] as const)(
    'rejects duplicate identifiers in %s before writes',
    (kind) => {
      const copy = structuredClone(official);
      (copy[kind] as unknown[]).push(copy[kind][0]);
      expect(() => validateReferenceData(copy)).toThrow(/duplicate/i);
    },
  );
  it('rejects broken city, airport and attraction references', () => {
    const badCity = structuredClone(official);
    badCity.cities[0].country_code = 'ZZ';
    const badAirport = structuredClone(official);
    badAirport.airports[0].city_id = 'missing-city';
    const badAttraction = structuredClone(official);
    badAttraction.attractions[0].city_id = 'missing-city';
    for (const copy of [badCity, badAirport, badAttraction])
      expect(() => validateReferenceData(copy)).toThrow(/unknown|inconsistent/);
  });
  it('rejects unsupported currencies, invalid airport codes and invalid IANA zones', () => {
    const currency = structuredClone(official);
    currency.countries[0].currency = 'ZZZ';
    const airport = structuredClone(official);
    airport.airports[0].iata_code = 'ABCD';
    const zone = structuredClone(official);
    zone.airports[0].time_zone = 'Not/A_Time_Zone';
    for (const copy of [currency, airport, zone])
      expect(() => validateReferenceData(copy)).toThrow();
  });
  it('rejects a missing required CSV column before creating incomplete documents', () => {
    const copy = structuredClone(official);
    Reflect.deleteProperty(copy.cities[0], 'name');
    expect(() => validateReferenceData(copy)).toThrow(/required column/);
  });
});

describe('Seed credentials reuse shared password validation (ACC-18, GEN-13)', () => {
  it('accepts valid accounts and rejects invalid passwords without echoing values', () => {
    expect(() =>
      validateSeedOptions({
        admin: { email: 'admin@yassin-test.example', password: 'SeedTest123' },
      }),
    ).not.toThrow();
    expect(() =>
      validateSeedOptions({
        admin: { email: 'admin@yassin-test.example', password: 'short' },
      }),
    ).toThrow(
      'Seed account credentials do not meet the shared validation rules',
    );
  });
  it('requires distinct account emails, including case differences', () => {
    expect(() =>
      validateSeedOptions({
        admin: { email: 'ADMIN@yassin-test.example', password: 'SeedTest123' },
        demo: {
          airlineModerator: {
            email: 'admin@yassin-test.example',
            password: 'SeedTest123',
          },
          hotelModerator: {
            email: 'hotel@yassin-test.example',
            password: 'SeedTest123',
          },
        },
      }),
    ).toThrow(/distinct/);
  });
});

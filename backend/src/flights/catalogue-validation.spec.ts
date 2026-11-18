import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  dateOnly,
  localDateTime,
  localToUtc,
  quoteAmount,
  validatePage,
} from './catalogue-validation.js';
import {
  CreateFlightDto,
  SearchFlightsQueryDto,
  UpdateCabinDto,
} from './dto/flight.dto.js';

describe('Airport-local time conversion (FLT-03, GEN-06)', () => {
  it('converts different airport wall times to the correct UTC instants', () => {
    expect(localToUtc('2026-12-01T10:00', 'Africa/Cairo').toISOString()).toBe(
      '2026-12-01T08:00:00.000Z',
    );
    expect(localToUtc('2026-12-01T10:00', 'Asia/Dubai').toISOString()).toBe(
      '2026-12-01T06:00:00.000Z',
    );
    expect(localToUtc('2026-12-01T10:00', 'Asia/Tokyo').toISOString()).toBe(
      '2026-12-01T01:00:00.000Z',
    );
  });
  it('formats in the airport zone independently of the host zone', () => {
    expect(
      localDateTime(new Date('2026-12-01T08:00:00Z'), 'Africa/Cairo'),
    ).toBe('2026-12-01T10:00:00');
  });
  it('rejects DST gaps, ambiguous folds and invalid calendar values', () => {
    expect(() => localToUtc('2026-03-08T02:30', 'America/New_York')).toThrow();
    expect(() => localToUtc('2026-11-01T01:30', 'America/New_York')).toThrow();
    expect(() => localToUtc('2026-02-30T10:00', 'Africa/Cairo')).toThrow();
    expect(() => localToUtc('2026-12-01T10:00Z', 'Africa/Cairo')).toThrow();
    expect(() => dateOnly('2026-02-30')).toThrow();
  });
  it('supports non-hour offsets and summer DST', () => {
    expect(localToUtc('2026-07-01T10:00', 'Asia/Kathmandu').toISOString()).toBe(
      '2026-07-01T04:15:00.000Z',
    );
    expect(localToUtc('2026-07-01T10:00', 'Europe/London').toISOString()).toBe(
      '2026-07-01T09:00:00.000Z',
    );
  });
  it('accepts explicit matching offsets to disambiguate a repeated DST time', () => {
    expect(
      localToUtc('2026-11-01T01:30-04:00', 'America/New_York').toISOString(),
    ).toBe('2026-11-01T05:30:00.000Z');
    expect(
      localToUtc('2026-11-01T01:30-05:00', 'America/New_York').toISOString(),
    ).toBe('2026-11-01T06:30:00.000Z');
    expect(() =>
      localToUtc('2026-11-01T01:30+02:00', 'America/New_York'),
    ).toThrow();
  });
});
describe('Flight DTO validation (GEN-02, GEN-13)', () => {
  it('rejects a UTC Z suffix in an airport-local input field', () => {
    const dto = plainToInstance(CreateFlightDto, {
      airlineId: '64b000000000000000000001',
      flightNumber: 'EA1',
      departureAirport: 'CAI',
      arrivalAirport: 'DXB',
      departureLocal: '2026-12-01T10:00Z',
      arrivalLocal: '2026-12-01T16:00',
    });
    expect(
      validateSync(dto).some((error) => error.property === 'departureLocal'),
    ).toBe(true);
  });
  it('rejects invalid dates, fractional counts, infinity and explicit null partial updates', () => {
    const dto = plainToInstance(SearchFlightsQueryDto, {
      departureAirport: 'CAI',
      arrivalAirport: 'DXB',
      departureDate: '2026-02-30',
      adults: '1.5',
      minPrice: Infinity,
    });
    expect(validateSync(dto).map((error) => error.property)).toEqual(
      expect.arrayContaining(['departureDate', 'adults', 'minPrice']),
    );
    expect(
      validateSync(plainToInstance(UpdateCabinDto, { seatCount: null })),
    ).not.toHaveLength(0);
  });
});

describe('Quote and pagination numeric bounds', () => {
  it('preserves fractional fares and sums infant pricing without binary intermediate rounding', () => {
    expect(quoteAmount(0.001, 1)).toBe(0.001);
    expect(quoteAmount(0.1, 3)).toBe(0.3);
    expect(quoteAmount(200, 2, 1)).toBe(420);
    expect(quoteAmount(1e308, 1)).toBe(1e308);
  });
  it('rejects overflow and counts that cannot be represented safely', () => {
    expect(() => quoteAmount(1e308, 2)).toThrow();
    expect(() => quoteAmount(1, 1e308)).toThrow();
    expect(() => validatePage(1e308)).toThrow();
    expect(() => validatePage(Number.MAX_SAFE_INTEGER)).toThrow();
  });
});

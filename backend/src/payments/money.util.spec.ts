import { describe, expect, it } from 'vitest';
import { fromMinorUnits, toMinorUnits } from './money.util.js';

describe('money.util', () => {
  it('converts two-decimal currencies to cents', () => {
    expect(toMinorUnits(250.5, 'USD')).toBe(25050);
    expect(toMinorUnits(0.1 + 0.2, 'EUR')).toBe(30); // float noise is rounded away
    expect(fromMinorUnits(25050, 'usd')).toBe(250.5);
  });

  it('keeps zero-decimal currencies as they are', () => {
    expect(toMinorUnits(15000, 'JPY')).toBe(15000);
    expect(fromMinorUnits(15000, 'JPY')).toBe(15000);
  });

  it('rejects negative or invalid amounts', () => {
    expect(() => toMinorUnits(-1, 'USD')).toThrow();
    expect(() => toMinorUnits(Number.NaN, 'USD')).toThrow();
  });
});

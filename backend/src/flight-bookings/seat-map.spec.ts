import { describe, expect, it } from 'vitest';
import {
  firstFreeSeats,
  isSeatInCabin,
  seatAt,
  seatIndex,
  seatNumbers,
} from './seat-map.js';

describe('seat map (FLT-28)', () => {
  it('numbers seats in rows of 6, A-F', () => {
    expect(seatNumbers(8)).toEqual([
      '1A',
      '1B',
      '1C',
      '1D',
      '1E',
      '1F',
      '2A',
      '2B',
    ]);
    expect(seatAt(13)).toBe('3B');
  });

  it('reads seat numbers back, case-insensitive', () => {
    expect(seatIndex('1A')).toBe(0);
    expect(seatIndex('3b')).toBe(13);
    expect(seatIndex('0A')).toBe(-1);
    expect(seatIndex('1G')).toBe(-1);
    expect(seatIndex('A1')).toBe(-1);
  });

  it('knows which seats exist in a cabin', () => {
    expect(isSeatInCabin('2B', 8)).toBe(true);
    expect(isSeatInCabin('2C', 8)).toBe(false);
  });

  it('picks the first free seats', () => {
    expect(firstFreeSeats(8, new Set(['1A', '1C']), 3)).toEqual([
      '1B',
      '1D',
      '1E',
    ]);
    expect(firstFreeSeats(2, new Set(['1A']), 2)).toEqual(['1B']);
  });
});

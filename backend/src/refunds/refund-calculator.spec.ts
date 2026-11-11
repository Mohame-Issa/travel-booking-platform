import { describe, expect, it } from 'vitest';
import { calculateRefund } from './refund-calculator.js';

const DAY = 86_400_000;
const NOW = new Date('2026-11-11T12:00:00Z');
const TIERS = [
  { daysBefore: 0, refundPercentage: 10 },
  { daysBefore: 7, refundPercentage: 50 },
  { daysBefore: 30, refundPercentage: 100 },
];

function calc(daysAhead: number, tiers = TIERS, fullRefund = false) {
  return calculateRefund({
    paidAmountMinor: 25050,
    tiers,
    startsAt: new Date(NOW.getTime() + daysAhead * DAY),
    now: NOW,
    fullRefund,
  });
}

describe('calculateRefund (PAY-03, FLT-09, HTL-10)', () => {
  it('uses the highest threshold not exceeding the days remaining', () => {
    expect(calc(10)).toMatchObject({
      refundPercentage: 50,
      appliedTierDaysBefore: 7,
      daysBeforeStart: 10,
    });
    expect(calc(30)).toMatchObject({
      refundPercentage: 100,
      appliedTierDaysBefore: 30,
    });
    expect(calc(45).refundPercentage).toBe(100);
    expect(calc(3)).toMatchObject({
      refundPercentage: 10,
      appliedTierDaysBefore: 0,
    });
  });

  it('a threshold equal to the days remaining applies', () => {
    expect(calc(7).refundPercentage).toBe(50);
  });

  it('counts whole days, rounded down (6.9 days = 6)', () => {
    expect(calc(6.9)).toMatchObject({
      daysBeforeStart: 6,
      refundPercentage: 10,
    });
  });

  it('no tier applies -> 0%', () => {
    expect(calc(3, [{ daysBefore: 7, refundPercentage: 50 }])).toMatchObject({
      refundPercentage: 0,
      appliedTierDaysBefore: null,
      amountMinor: 0,
    });
    expect(calc(10, []).amountMinor).toBe(0);
  });

  it('tier order in the list does not matter', () => {
    expect(calc(10, [...TIERS].reverse()).refundPercentage).toBe(50);
  });

  it('rounds the amount down so we never over-refund', () => {
    // 25050 * 33% = 8266.5 -> 8266
    expect(
      calc(10, [{ daysBefore: 0, refundPercentage: 33 }]).amountMinor,
    ).toBe(8266);
  });

  it('provider cancellations are 100% regardless of tiers', () => {
    expect(calc(1, [], true)).toEqual({
      refundPercentage: 100,
      daysBeforeStart: null,
      appliedTierDaysBefore: null,
      amountMinor: 25050,
    });
  });
});

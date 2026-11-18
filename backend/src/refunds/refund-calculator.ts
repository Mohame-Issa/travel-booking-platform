import type { CancellationTier } from '../common/interfaces/index.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RefundCalculation {
  /** 0-100 */
  refundPercentage: number;
  /** Whole days left before departure / check-in. null for full refunds. */
  daysBeforeStart: number | null;
  /** Threshold of the tier used. null if no tier applied or full refund. */
  appliedTierDaysBefore: number | null;
  /** Refund in MINOR units, never more than the amount paid. */
  amountMinor: number;
}

/**
 * Pure refund maths (PAY-03), no database, no Stripe: easy to test and explain.
 *
 * - fullRefund: provider-initiated cancellations are refunded 100% (PAY-03, FLT-06).
 * - otherwise FLT-09 / HTL-10: use the tier with the HIGHEST threshold that does
 *   not exceed the days remaining; if no tier applies, the refund is 0%.
 *   HTL-21: hotels apply it to the full total (we always use the full amount paid).
 *
 * Days remaining = whole days, rounded down: 6 days 23 hours counts as 6.
 * Amount is rounded DOWN to the minor unit so we never refund more than the
 * policy allows.
 */
export function calculateRefund(params: {
  paidAmountMinor: number;
  tiers: CancellationTier[];
  startsAt: Date;
  now: Date;
  fullRefund: boolean;
}): RefundCalculation {
  const { paidAmountMinor, tiers, startsAt, now, fullRefund } = params;

  if (fullRefund) {
    return {
      refundPercentage: 100,
      daysBeforeStart: null,
      appliedTierDaysBefore: null,
      amountMinor: paidAmountMinor,
    };
  }

  const daysBeforeStart = Math.floor(
    (startsAt.getTime() - now.getTime()) / MS_PER_DAY,
  );

  let applied: CancellationTier | null = null;
  for (const tier of tiers) {
    if (
      tier.daysBefore <= daysBeforeStart &&
      (!applied || tier.daysBefore > applied.daysBefore)
    ) {
      applied = tier;
    }
  }

  const refundPercentage = applied ? applied.refundPercentage : 0;
  return {
    refundPercentage,
    daysBeforeStart,
    appliedTierDaysBefore: applied ? applied.daysBefore : null,
    amountMinor: Math.floor((paidAmountMinor * refundPercentage) / 100),
  };
}

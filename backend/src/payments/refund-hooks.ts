import type Stripe from 'stripe';

/**
 * What the Stripe webhook (payments) needs from the refunds module.
 * Defined HERE so payments does not import refunds (that would be a circular
 * import, because refunds already uses the Payment model). The refunds module
 * implements it and provides it under REFUND_HOOKS.
 */
export interface RefundHooks {
  /**
   * The money arrived but the booking can no longer be confirmed (hold
   * expired, GEN-11). Refund it in full.
   */
  refundLatePayment(paymentId: string): Promise<void>;

  /** Stripe event refund.updated / refund.failed: keep our status in sync. */
  onStripeRefundUpdated(refund: Stripe.Refund): Promise<void>;
}

export const REFUND_HOOKS = 'REFUND_HOOKS';

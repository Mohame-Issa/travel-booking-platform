/**
 * Shared constants of the payments module (Youssef Khafagy).
 */

/**
 * Our own record of a Stripe PaymentIntent's outcome (PAY-01).
 * Only the webhook moves a payment to SUCCEEDED, never the client.
 *
 *   PENDING   -> PaymentIntent created, waiting for the card result
 *   FAILED    -> Stripe reported payment_intent.payment_failed (user may retry
 *                until the hold expires, which moves it back to PENDING)
 *   SUCCEEDED -> Stripe reported payment_intent.succeeded (verified by webhook)
 *   CANCELLED -> the hold expired, so the PaymentIntent was cancelled (PAY-01)
 */
export enum PaymentStatus {
  PENDING = 'pending',
  FAILED = 'failed',
  SUCCEEDED = 'succeeded',
  CANCELLED = 'cancelled',
}

/** DI token for the configured Stripe client (see stripe.provider.ts). */
export const STRIPE_CLIENT = 'STRIPE_CLIENT';

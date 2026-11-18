import type { BookingType } from './booking.interfaces.js';

/**
 * Refund contract. Owner: Youssef Khafagy (backend/src/refunds).
 * Caller: Omar Hashem's cancellation endpoints and flight.cancelled handler.
 */

export type RefundReason =
  'user_cancellation' | 'provider_cancellation' | 'flight_cancelled';

export interface CreateRefundInput {
  bookingType: BookingType;
  bookingId: string;
  reason: RefundReason;
  /** User who requested the cancellation, or undefined for system-triggered refunds. */
  requestedBy?: string;
  /**
   * true = refund 100% regardless of the policy (e.g. the airline cancelled
   * the flight). false/undefined = calculate from the policy that applied to
   * the booking (PAY-03).
   */
  fullRefund?: boolean;
}

export type RefundStatus = 'pending' | 'succeeded' | 'failed';

/**
 * Status returned by createRefund(). 'none' = the policy gives 0%, so no
 * refund is issued or recorded (PAY-03: only cancellations with a POSITIVE
 * refund amount get a refund).
 */
export type RefundResultStatus = RefundStatus | 'none';

export interface RefundResult {
  /** null when no refund is due (status 'none'). */
  refundId: string | null;
  /** Amount refunded in the booking currency. 0 when status is 'none'. */
  amount: number;
  currency: string;
  status: RefundResultStatus;
}

export interface RefundService {
  createRefund(input: CreateRefundInput): Promise<RefundResult>;
}

export const REFUND_SERVICE = 'REFUND_SERVICE';

/**
 * FLT-26 / HTL-21: the user sees the refund amount BEFORE confirming the
 * cancellation. Omar Hashem's cancel flow calls previewRefund() so the amount
 * shown is computed exactly like the refund that createRefund() pays.
 * Owner: Youssef Khafagy.
 */
export interface RefundPreview {
  /** Major units, in the booking currency. */
  amount: number;
  currency: string;
  refundPercentage: number;
  daysBeforeStart: number | null;
  appliedTierDaysBefore: number | null;
}

export interface RefundPreviewService {
  previewRefund(
    input: Omit<CreateRefundInput, 'requestedBy'>,
  ): Promise<RefundPreview>;
}

export const REFUND_PREVIEW_SERVICE = 'REFUND_PREVIEW_SERVICE';

/**
 * FLT-27 (bonus): refund the fare difference when a user changes a Confirmed
 * flight booking to a cheaper flight. Owner: Youssef Khafagy. Caller: the
 * flight change service in flight-bookings. Idempotent per change.
 */
export interface FareDifferenceRefundInput {
  bookingType: BookingType;
  bookingId: string;
  changeId: string;
  /** Major units, > 0, in the booking currency. */
  amount: number;
  requestedBy?: string;
}

export interface FareDifferenceRefundService {
  refundFareDifference(input: FareDifferenceRefundInput): Promise<RefundResult>;
}

export const FARE_DIFFERENCE_REFUND_SERVICE = 'FARE_DIFFERENCE_REFUND_SERVICE';

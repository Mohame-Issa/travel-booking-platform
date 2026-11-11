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

export interface RefundResult {
  refundId: string;
  /** Amount refunded in the booking currency. 0 if the policy gives no refund. */
  amount: number;
  currency: string;
  status: RefundStatus;
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

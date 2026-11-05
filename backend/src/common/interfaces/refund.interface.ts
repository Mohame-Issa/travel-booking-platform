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

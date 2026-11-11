/**
 * ============================================================================
 *  PROPOSED SHARED CONTRACT - NOT YET AGREED WITH THE TEAM
 * ============================================================================
 * FLT-26 / HTL-21: the user sees the refund amount BEFORE confirming the
 * cancellation. Omar Hashem's cancel flow should call previewRefund() so the
 * amount shown is computed exactly like the refund that createRefund() pays.
 *
 * TODO(Mohamed Amr): approve moving this into common/interfaces/refund.interface.ts.
 * TODO(Omar Hashem): inject REFUND_PREVIEW_SERVICE in the cancel endpoints.
 */
import type { CreateRefundInput } from '../common/interfaces/index.js';

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

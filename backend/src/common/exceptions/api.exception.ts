import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes.js';

export interface ErrorDetail {
  /** Dotted path of the field, e.g. "passengers.0.firstName". Omit for non-field errors. */
  field?: string;
  messages: string[];
}

/**
 * Throw this for business-rule errors so the response carries a stable
 * machine-readable `code`:
 *
 *   throw new ApiException(HttpStatus.CONFLICT, ErrorCode.EMAIL_ALREADY_REGISTERED,
 *     'This email is already registered');
 *
 * Plain Nest exceptions (NotFoundException etc.) also work; the global filter
 * gives them a generic code based on the status.
 */
export class ApiException extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super({ code, message, details }, status);
  }
}

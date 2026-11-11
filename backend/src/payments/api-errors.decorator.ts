import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';

/** Default message per code, matching what the services actually throw. */
const MESSAGES: Partial<Record<ErrorCode, string>> = {
  [ErrorCode.VALIDATION_FAILED]: 'Validation failed',
  [ErrorCode.INVALID_ID]: 'Invalid id',
  [ErrorCode.AUTH_REQUIRED]: 'Please log in',
  [ErrorCode.SESSION_EXPIRED]: 'Your session has expired, please log in again',
  [ErrorCode.INSUFFICIENT_ROLE]:
    'You do not have permission to perform this action',
  [ErrorCode.NOT_RESOURCE_OWNER]: 'You do not have access to this resource',
  [ErrorCode.NOT_FOUND]: 'Not found',
  [ErrorCode.NOT_IMPLEMENTED]:
    'FLIGHT_BOOKING_PAYMENT_READER is not available yet (placeholder)',
  [ErrorCode.BOOKING_NOT_PAYABLE]:
    'Booking is Confirmed; only Pending Payment bookings can be paid',
  [ErrorCode.HOLD_EXPIRED]: 'The hold on this booking has expired',
  [ErrorCode.POLICIES_NOT_ACCEPTED]:
    'Accept the provider policies before paying',
  [ErrorCode.PAYMENT_ALREADY_EXISTS]:
    'The previous attempt failed. Use POST /api/payments/:id/retry',
  [ErrorCode.PAYMENT_NOT_RETRYABLE]: 'A succeeded payment cannot be retried',
  [ErrorCode.UNSUPPORTED_CURRENCY]: 'Currency XYZ is not supported',
  [ErrorCode.PAYMENT_PROVIDER_ERROR]: 'Payment provider error: ...',
  [ErrorCode.STRIPE_NOT_CONFIGURED]:
    'Payments are not configured on this server (STRIPE_SECRET_KEY missing)',
  [ErrorCode.INVALID_WEBHOOK_SIGNATURE]: 'Invalid Stripe signature',
};

const REASON: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
  [HttpStatus.NOT_IMPLEMENTED]: 'Not Implemented',
  [HttpStatus.BAD_GATEWAY]: 'Bad Gateway',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
};

export type ApiErrorItem = ErrorCode | { code: ErrorCode; message: string };

/**
 * Swagger docs for one HTTP status with a correct example PER error code
 * (the shared ErrorResponseDto has a single fixed 400 example). Pick an
 * example from the dropdown in Swagger UI.
 *
 *   @ApiErrors(HttpStatus.CONFLICT, ErrorCode.HOLD_EXPIRED, ErrorCode.BOOKING_NOT_PAYABLE)
 */
export function ApiErrors(status: HttpStatus, ...items: ApiErrorItem[]) {
  const examples = Object.fromEntries(
    items.map((item) => {
      const code = typeof item === 'string' ? item : item.code;
      const message =
        typeof item === 'string' ? (MESSAGES[code] ?? code) : item.message;
      return [
        code,
        {
          summary: code,
          value: {
            statusCode: status,
            error: REASON[status] ?? 'Error',
            code,
            message,
            ...(code === ErrorCode.VALIDATION_FAILED
              ? {
                  details: [
                    {
                      field: 'bookingType',
                      messages: [
                        'bookingType must be one of the following values: flight, hotel',
                      ],
                    },
                  ],
                }
              : {}),
            path: '/api/...',
            timestamp: '2026-11-11T12:00:00.000Z',
          },
        },
      ];
    }),
  );
  const codes = items.map((i) => (typeof i === 'string' ? i : i.code));
  return applyDecorators(
    ApiExtraModels(ErrorResponseDto),
    ApiResponse({
      status,
      description: codes.join(', '),
      content: {
        'application/json': {
          schema: { $ref: getSchemaPath(ErrorResponseDto) },
          examples,
        },
      },
    }),
  );
}

import { HttpStatus, ValidationError, ValidationPipe } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes.js';
import { ApiException, ErrorDetail } from '../exceptions/api.exception.js';

/**
 * Global validation (GEN-02, GEN-13). Registered once in main.ts.
 * - whitelist + forbidNonWhitelisted: unknown fields in a body are rejected
 * - transform: query strings like "?page=2" become numbers in your DTO
 * - errors come back as field-level `details` in the shared error format
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) =>
      new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Validation failed',
        flattenValidationErrors(errors),
      ),
  });
}

export function flattenValidationErrors(
  errors: ValidationError[],
  parent = '',
): ErrorDetail[] {
  const out: ErrorDetail[] = [];
  for (const err of errors) {
    const field = parent ? `${parent}.${err.property}` : err.property;
    if (err.constraints) {
      out.push({ field, messages: Object.values(err.constraints) });
    }
    if (err.children && err.children.length > 0) {
      out.push(...flattenValidationErrors(err.children, field));
    }
  }
  return out;
}

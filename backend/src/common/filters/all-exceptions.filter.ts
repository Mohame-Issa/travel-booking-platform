import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Error as MongooseError } from 'mongoose';
import { ErrorCode } from '../constants/error-codes.js';
import type { ErrorResponseDto } from '../dto/error-response.dto.js';
import type { ErrorDetail } from '../exceptions/api.exception.js';

const DEFAULT_CODE_FOR_STATUS: Partial<Record<number, string>> = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  501: ErrorCode.NOT_IMPLEMENTED,
};

/**
 * Turns every thrown error into the shared error format (see ErrorResponseDto).
 * Registered globally in main.ts, so modules never format errors themselves.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { status, code, message, details } = this.normalize(exception);

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponseDto = {
      statusCode: status,
      error: httpStatusText(status),
      code,
      message,
      ...(details && details.length > 0 ? { details } : {}),
      path: req.originalUrl,
      timestamp: new Date().toISOString(),
    };
    res.status(status).json(body);
  }

  private normalize(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: ErrorDetail[];
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const fallbackCode = DEFAULT_CODE_FOR_STATUS[status] ?? `HTTP_${status}`;

      if (typeof response === 'string') {
        return { status, code: fallbackCode, message: response };
      }
      const r = response as {
        code?: string;
        message?: string | string[];
        details?: ErrorDetail[];
      };
      // Nest's built-in exceptions may carry message as an array of strings.
      const message = Array.isArray(r.message)
        ? r.message.join('; ')
        : (r.message ?? exception.message);
      return {
        status,
        code: r.code ?? fallbackCode,
        message,
        details: r.details,
      };
    }

    // Invalid ObjectId used in a query, e.g. findById('abc').
    if (exception instanceof MongooseError.CastError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ErrorCode.INVALID_ID,
        message: `Invalid value for ${exception.path}`,
        details: [
          { field: exception.path, messages: [`Invalid ${exception.kind}`] },
        ],
      };
    }

    // Schema validation failed on save.
    if (exception instanceof MongooseError.ValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Validation failed',
        details: Object.values(exception.errors).map((e) => ({
          field: e.path,
          messages: [e.message],
        })),
      };
    }

    // Unique index violation (MongoServerError code 11000).
    if (isDuplicateKeyError(exception)) {
      const fields = Object.keys(
        exception.keyValue ?? exception.keyPattern ?? {},
      );
      return {
        status: HttpStatus.CONFLICT,
        code: ErrorCode.DUPLICATE_KEY,
        message: `A record with the same ${fields.join(', ') || 'value'} already exists`,
        details: fields.map((field) => ({
          field,
          messages: ['Must be unique'],
        })),
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Something went wrong. Please try again later.',
    };
  }
}

function isDuplicateKeyError(e: unknown): e is {
  code: number;
  keyValue?: Record<string, unknown>;
  keyPattern?: Record<string, unknown>;
} {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === 11000
  );
}

function httpStatusText(status: number): string {
  const name = HttpStatus[status];
  if (!name) return 'Error';
  return name
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

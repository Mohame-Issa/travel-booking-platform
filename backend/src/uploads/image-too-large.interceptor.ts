import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { catchError, throwError } from 'rxjs';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';

/**
 * GEN-08: multer rejects files over 5 MB before the service runs, with a bare 413.
 * Place this BEFORE FileInterceptor so clients get the shared IMAGE_TOO_LARGE code.
 */
@Injectable()
export class ImageTooLargeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler) {
    return next
      .handle()
      .pipe(
        catchError((err: unknown) =>
          throwError(() =>
            err instanceof PayloadTooLargeException
              ? new ApiException(
                  HttpStatus.PAYLOAD_TOO_LARGE,
                  ErrorCode.IMAGE_TOO_LARGE,
                  'Images must be 5 MB or smaller',
                )
              : err,
          ),
        ),
      );
  }
}

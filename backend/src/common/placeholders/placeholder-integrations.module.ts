/**
 * ============================================================================
 *  TEMPORARY PLACEHOLDERS - DELETE EACH ONE WHEN THE REAL SERVICE IS MERGED
 * ============================================================================
 *
 * These stand in for teammates' services so the app starts and the code that
 * depends on them compiles before those services exist.
 *
 * HOW TO REPLACE A PLACEHOLDER (service owner, in your own PR):
 *   1. In your module, bind your service to the token and export it, and make
 *      the module @Global() (or ask the team leader where to import it):
 *        @Global()
 *        @Module({
 *          providers: [AuditService, { provide: AUDIT_SERVICE, useExisting: AuditService }],
 *          exports: [AUDIT_SERVICE],
 *        })
 *   2. Import your module in AppModule.
 *   3. Delete the matching entry from the `providers` and `exports` arrays below
 *      (and its class). Two providers for one token = whichever loads last wins,
 *      so do not leave both.
 *
 *   Token                              Owner             Placeholder behaviour

 */
import { Global, HttpStatus, Logger, Module } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes.js';
import { ApiException } from '../exceptions/api.exception.js';
import {
  BookingLifecycleService,
  BookingPaymentReader,
  BookingPaymentSnapshot,
  UpcomingConfirmedBookingsChecker,
} from '../interfaces/index.js';

const logger = new Logger('TEMPORARY-PLACEHOLDER');

/** TEMPORARY: replaced by the flight and hotel booking modules. */
class PlaceholderUpcomingBookingsChecker implements UpcomingConfirmedBookingsChecker {
  constructor(private readonly token: string) {}
  async hasUpcomingConfirmedBookings(): Promise<boolean> {
    logger.warn(
      `${this.token} not merged yet - assuming the user has NO upcoming bookings`,
    );
    return false;
  }
}

/** TEMPORARY: replaced by the flight and hotel booking modules. */
class PlaceholderBookingLifecycle implements BookingLifecycleService {
  constructor(private readonly token: string) {}
  confirmBooking(): Promise<void> {
    return Promise.reject(notMerged(this.token));
  }
  releaseInventory(): Promise<void> {
    return Promise.reject(notMerged(this.token));
  }
}

/** TEMPORARY: replaced by the flight and hotel booking modules. */
class PlaceholderBookingPaymentReader implements BookingPaymentReader {
  constructor(private readonly token: string) {}
  getPaymentSnapshot(): Promise<BookingPaymentSnapshot | null> {
    return Promise.reject(notMerged(this.token));
  }
}

function notMerged(token: string): ApiException {
  return new ApiException(
    HttpStatus.NOT_IMPLEMENTED,
    ErrorCode.NOT_IMPLEMENTED,
    `${token} is not available yet (placeholder)`,
  );
}

@Global()
@Module({
  providers: [
    

  ],
  exports: [
    
  ],
})
export class PlaceholderIntegrationsModule {}

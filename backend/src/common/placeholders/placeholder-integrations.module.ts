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
 *   AUDIT_SERVICE                      Mohamed Hashad    logs a warning
 *   NOTIFICATION_SERVICE               Mohamed Hashad    logs a warning
 *   HOTEL_UPCOMING_BOOKINGS_CHECKER    Mohamed Hashad    returns false
 *   HOTEL_BOOKING_LIFECYCLE            Mohamed Hashad    throws 501
 *   HOTEL_BOOKING_PAYMENT_READER       Mohamed Hashad    throws 501
 */
import { Global, HttpStatus, Injectable, Logger, Module } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes.js';
import { ApiException } from '../exceptions/api.exception.js';
import {
  AUDIT_SERVICE,
  AuditLogInput,
  AuditService,
  BookingLifecycleService,
  BookingPaymentReader,
  BookingPaymentSnapshot,
  FLIGHT_BOOKING_PAYMENT_READER,
  FLIGHT_BOOKING_LIFECYCLE,
  FLIGHT_UPCOMING_BOOKINGS_CHECKER,
  HOTEL_BOOKING_LIFECYCLE,
  HOTEL_BOOKING_PAYMENT_READER,
  HOTEL_UPCOMING_BOOKINGS_CHECKER,
  NOTIFICATION_SERVICE,
  NotificationService,
  NotifyInput,
  UpcomingConfirmedBookingsChecker,
} from '../interfaces/index.js';

const logger = new Logger('TEMPORARY-PLACEHOLDER');

/** TEMPORARY: replaced by Mohamed Hashad's AuditService. */
@Injectable()
class PlaceholderAuditService implements AuditService {
  async record(input: AuditLogInput): Promise<void> {
    logger.warn(
      `AUDIT_SERVICE not merged yet - audit entry NOT saved: ${input.action} on ${input.targetType} ${input.targetId ?? ''}`,
    );
  }
}

/** TEMPORARY: replaced by Mohamed Hashad's NotificationService. */
@Injectable()
class PlaceholderNotificationService implements NotificationService {
  async notify(input: NotifyInput): Promise<void> {
    logger.warn(
      `NOTIFICATION_SERVICE not merged yet - notification NOT saved: ${input.type}`,
    );
  }
  async notifyMany(
    userIds: string[],
    input: Omit<NotifyInput, 'userId'>,
  ): Promise<void> {
    logger.warn(
      `NOTIFICATION_SERVICE not merged yet - ${userIds.length} notifications NOT saved: ${input.type}`,
    );
  }
}

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
    { provide: AUDIT_SERVICE, useClass: PlaceholderAuditService },
    { provide: NOTIFICATION_SERVICE, useClass: PlaceholderNotificationService },
    
    {
      provide: HOTEL_UPCOMING_BOOKINGS_CHECKER,
      useValue: new PlaceholderUpcomingBookingsChecker(
        HOTEL_UPCOMING_BOOKINGS_CHECKER,
      ),
    },
   
    {
      provide: HOTEL_BOOKING_LIFECYCLE,
      useValue: new PlaceholderBookingLifecycle(HOTEL_BOOKING_LIFECYCLE),
    },
  
    {
      provide: HOTEL_BOOKING_PAYMENT_READER,
      useValue: new PlaceholderBookingPaymentReader(
        HOTEL_BOOKING_PAYMENT_READER,
      ),
    },
  ],
  exports: [
    AUDIT_SERVICE,
    NOTIFICATION_SERVICE,
    HOTEL_UPCOMING_BOOKINGS_CHECKER,
    HOTEL_BOOKING_LIFECYCLE,
    HOTEL_BOOKING_PAYMENT_READER,
  ],
})
export class PlaceholderIntegrationsModule {}

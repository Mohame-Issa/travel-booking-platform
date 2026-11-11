/**
 * ============================================================================
 *  PROPOSED SHARED CONTRACT - NOT YET AGREED WITH THE TEAM
 * ============================================================================
 * Payments needs to READ a booking (owner, total, status, hold expiry, start
 * date, provider policies). common/interfaces only lets us confirm/release.
 *
 * TODO(Mohamed Amr): approve moving this file into common/interfaces.
 * TODO(Omar Hashem): implement FLIGHT_BOOKING_PAYMENT_READER in flight-bookings
 *   (airline tiers FLT-09 + baggage FLT-04/FLT-08 for the booked cabin).
 * TODO(Mohamed Hashad): implement HOTEL_BOOKING_PAYMENT_READER in hotel-bookings
 *   (hotel tiers HTL-10 + check-in/out times HTL-09).
 * Both read Yassin Shawr's Airline Policy / Hotel Policy schemas.
 * Until then the placeholders below answer 501 NOT_IMPLEMENTED.
 */
import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import type { BookingStatus } from '../common/interfaces/index.js';

export interface CancellationTier {
  /** Days before departure / check-in, integer >= 0 (FLT-09, HTL-10). */
  daysBefore: number;
  /** 0-100. */
  refundPercentage: number;
}

export interface BaggagePolicy {
  freeBags: number; // FLT-04, booked cabin
  maxWeightKgPerBag: number; // FLT-04
  extraBagPrice: number; // FLT-08, major units
  maxExtraBags: number; // FLT-08
}

/** Provider policies shown before payment (PAY-02). */
export interface BookingPolicies {
  cancellationTiers: CancellationTier[];
  /** Flights only. */
  baggagePolicy: BaggagePolicy | null;
  /** Hotels only, "HH:mm" (HTL-09). */
  checkInTime: string | null;
  checkOutTime: string | null;
}

export interface BookingPaymentSnapshot {
  bookingId: string;
  userId: string;
  status: BookingStatus;
  /** Booking total in MAJOR units (e.g. 250.5), computed by the booking module. */
  totalAmount: number;
  currency: string;
  /** End of the 10-minute hold (FLT-22 / HTL-18). null once confirmed. */
  holdExpiresAt: Date | null;
  /** Flight departure or hotel check-in (UTC). Used for refund tiers. */
  startsAt: Date;
  policies: BookingPolicies;
}

export interface BookingPaymentReader {
  /** Returns null if the booking does not exist. */
  getPaymentSnapshot(bookingId: string): Promise<BookingPaymentSnapshot | null>;
}

export const FLIGHT_BOOKING_PAYMENT_READER = 'FLIGHT_BOOKING_PAYMENT_READER';
export const HOTEL_BOOKING_PAYMENT_READER = 'HOTEL_BOOKING_PAYMENT_READER';

/** TEMPORARY placeholder. Delete when the owners bind the real readers. */
class PlaceholderBookingPaymentReader implements BookingPaymentReader {
  constructor(private readonly token: string) {}
  getPaymentSnapshot(): Promise<BookingPaymentSnapshot | null> {
    return Promise.reject(
      new ApiException(
        HttpStatus.NOT_IMPLEMENTED,
        ErrorCode.NOT_IMPLEMENTED,
        `${this.token} is not available yet (placeholder)`,
      ),
    );
  }
}

export const placeholderBookingPaymentReaders = [
  {
    provide: FLIGHT_BOOKING_PAYMENT_READER,
    useValue: new PlaceholderBookingPaymentReader(
      FLIGHT_BOOKING_PAYMENT_READER,
    ),
  },
  {
    provide: HOTEL_BOOKING_PAYMENT_READER,
    useValue: new PlaceholderBookingPaymentReader(HOTEL_BOOKING_PAYMENT_READER),
  },
];

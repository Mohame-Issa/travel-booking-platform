/**
 * Booking payment reader contract (PAY-01, PAY-02, PAY-03).
 * Caller: Youssef Khafagy's payments and refunds modules, which need to READ a
 * booking (owner, total, status, hold expiry, start date, provider policies).
 * Implementers:
 *   FLIGHT_BOOKING_PAYMENT_READER  Omar Hashem     (airline tiers FLT-09, baggage FLT-04/FLT-08)
 *   HOTEL_BOOKING_PAYMENT_READER   Mohamed Hashad  (hotel tiers HTL-10, check-in/out times HTL-09)
 * Both read Yassin Shawr's Airline Policy / Hotel Policy schemas.
 * Until they are bound, common/placeholders provides placeholders that answer 501.
 */
import type { BookingStatus } from './booking.interfaces.js';

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

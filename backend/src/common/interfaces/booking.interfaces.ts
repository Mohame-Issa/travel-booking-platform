/**
 * Shared booking contracts. Owners:
 *   - Flight bookings: Omar Hashem   (backend/src/flight-bookings)
 *   - Hotel bookings:  Mohamed Hashad (backend/src/hotel-bookings)
 * Callers:
 *   - Payments (Youssef Khafagy) calls confirmBooking / releaseInventory
 *   - Users (Mohamed Amr) calls hasUpcomingConfirmedBookings for ACC-12
 *
 * Inject an implementation with its token, never the concrete class:
 *   constructor(@Inject(FLIGHT_BOOKING_LIFECYCLE) private flights: BookingLifecycleService) {}
 */

export type BookingType = 'flight' | 'hotel';

/** GEN-11 lifecycle. These are the only allowed states and transitions. */
export enum BookingStatus {
  PENDING_PAYMENT = 'Pending Payment',
  CONFIRMED = 'Confirmed',
  COMPLETED = 'Completed',
  EXPIRED = 'Expired',
  CANCELLED = 'Cancelled',
}

export interface ConfirmBookingInput {
  bookingId: string;
  /** Id of the Payment document whose success was verified by the Stripe webhook. */
  paymentId: string;
}

export type ReleaseInventoryReason =
  'payment_failed' | 'payment_expired' | 'hold_expired' | 'cancelled';

export interface ReleaseInventoryInput {
  bookingId: string;
  reason: ReleaseInventoryReason;
}

/**
 * Implemented once for flights and once for hotels.
 * Both methods must be idempotent: calling them twice for the same booking
 * must not double-confirm or double-release.
 */
export interface BookingLifecycleService {
  /**
   * Pending Payment -> Confirmed after payment is verified (PAY-01).
   * Flights also issue the booking reference and e-ticket here (FLT-23).
   */
  confirmBooking(input: ConfirmBookingInput): Promise<void>;

  /**
   * Gives held/booked seats or rooms back to inventory and moves the booking
   * to Expired (payment_failed / payment_expired / hold_expired) or
   * Cancelled (cancelled).
   */
  releaseInventory(input: ReleaseInventoryInput): Promise<void>;
}

/**
 * ACC-12: a user cannot deactivate their account while they have an upcoming
 * Confirmed booking. "Upcoming" means status Confirmed and the trip has not
 * finished yet (flight departure / hotel check-out is in the future).
 */
export interface UpcomingConfirmedBookingsChecker {
  hasUpcomingConfirmedBookings(userId: string): Promise<boolean>;
}

/** DI tokens. Each owner binds their service to these in their module. */
export const FLIGHT_BOOKING_LIFECYCLE = 'FLIGHT_BOOKING_LIFECYCLE';
export const HOTEL_BOOKING_LIFECYCLE = 'HOTEL_BOOKING_LIFECYCLE';
export const FLIGHT_UPCOMING_BOOKINGS_CHECKER =
  'FLIGHT_UPCOMING_BOOKINGS_CHECKER';
export const HOTEL_UPCOMING_BOOKINGS_CHECKER =
  'HOTEL_UPCOMING_BOOKINGS_CHECKER';

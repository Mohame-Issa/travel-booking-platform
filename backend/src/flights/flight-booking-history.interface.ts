import { Injectable } from '@nestjs/common';
import type { ClientSession } from 'mongoose';

/** Omar's read-only adapter must include ALL booking states and both round-trip segments. */
export interface FlightBookingHistoryReader {
  hasAnyBooking(
    flightId: string,
    session: ClientSession,
  ): Promise<boolean | null>;
}
export const FLIGHT_BOOKING_HISTORY_READER = 'FLIGHT_BOOKING_HISTORY_READER';

/** null means unknown; zero current seats does not prove zero historical bookings (FLT-05). */
@Injectable()
export class PendingFlightBookingHistoryReader implements FlightBookingHistoryReader {
  async hasAnyBooking(): Promise<null> {
    return null;
  }
}

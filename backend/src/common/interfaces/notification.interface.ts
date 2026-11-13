/**
 * In-app notification contract (GEN-01). Owner: Mohamed Hashad
 * (backend/src/notifications).
 *
 *   constructor(@Inject(NOTIFICATION_SERVICE) private readonly notifications: NotificationService) {}
 *
 *   await this.notifications.notify({
 *     userId: booking.userId,
 *     type: 'booking_confirmed',
 *     title: 'Booking confirmed',
 *     message: `Your booking ${booking.reference} is confirmed.`,
 *     data: { bookingType: 'flight', bookingId: booking.id },
 *   });
 */

/** GEN-01 events. Add a type here (and tell the team) before using a new one. */
export type NotificationType =
  | 'booking_confirmed'
  | 'booking_cancelled'
  | 'refund_issued'
  /** Payment failed or the hold expired before payment (PAY-01, HTL-18, FLT-22). */
  | 'payment_failed'
  | 'flight_schedule_changed'
  | 'account_suspended'
  | 'account_reactivated'
  | 'provider_deactivated'
  | 'provider_reactivated';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  /** Ids the frontend can use to link to the related item. */
  data?: Record<string, unknown>;
}

export interface NotificationService {
  notify(input: NotifyInput): Promise<void>;
  /** Same notification for many users, e.g. all passengers of a changed flight. */
  notifyMany(
    userIds: string[],
    input: Omit<NotifyInput, 'userId'>,
  ): Promise<void>;
}

export const NOTIFICATION_SERVICE = 'NOTIFICATION_SERVICE';

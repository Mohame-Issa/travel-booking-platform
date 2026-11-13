import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ApiException, BookingStatus, ErrorCode, HOTEL_BOOKING_LIFECYCLE, HotelBooking, NOTIFICATION_SERVICE,
  REFUND_PREVIEW_SERVICE, REFUND_SERVICE,
  type BookingLifecycleService, type NotificationService, type RefundPreview, type RefundPreviewService,
  type RefundService,
} from './hotel-cancellation.imports.js';

@Injectable()
export class HotelBookingCancellationService {
  private readonly logger = new Logger(HotelBookingCancellationService.name);

  constructor(
    @InjectModel(HotelBooking.name) private readonly hotelBookings: Model<HotelBooking>,
    @Inject(NOTIFICATION_SERVICE) private readonly notifications: NotificationService,
    private readonly moduleRef: ModuleRef,
  ) {}

  // Resolved lazily to avoid circular dependencies with the payments/refunds modules.
  private get lifecycle(): BookingLifecycleService {
    return this.moduleRef.get<BookingLifecycleService>(HOTEL_BOOKING_LIFECYCLE, { strict: false });
  }
  private get refunds(): RefundService {
    return this.moduleRef.get<RefundService>(REFUND_SERVICE, { strict: false });
  }
  private get refundPreviews(): RefundPreviewService {
    return this.moduleRef.get<RefundPreviewService>(REFUND_PREVIEW_SERVICE, { strict: false });
  }

  /** HTL-21: the reservation must be the user's own, Confirmed, and before check-in. */
  private async ownedConfirmed(userId: string, id: string) {
    const b = await this.hotelBookings.findOne({ _id: id, userId }).lean();
    if (!b) throw new NotFoundException('Hotel booking not found');
    if (b.status !== BookingStatus.CONFIRMED)
      throw new ApiException(HttpStatus.BAD_REQUEST, ErrorCode.BOOKING_NOT_CANCELLABLE, `A ${b.status} reservation cannot be cancelled`);
    if (b.checkInDate <= new Date())
      throw new ApiException(HttpStatus.BAD_REQUEST, ErrorCode.BOOKING_NOT_CANCELLABLE, 'Cancellation after the check-in date is not allowed');
    return b;
  }

  /** The refund is shown BEFORE the user confirms (computed by Youssef's service). */
  async refundPreview(userId: string, id: string): Promise<RefundPreview> {
    await this.ownedConfirmed(userId, id);
    return this.refundPreviews.previewRefund({ bookingType: 'hotel', bookingId: id, reason: 'user_cancellation' });
  }

  async cancel(userId: string, id: string) {
    await this.ownedConfirmed(userId, id);

    // Hashad's function frees the rooms and sets the status to Cancelled (safe to call twice).
    await this.lifecycle.releaseInventory({ bookingId: id, reason: 'cancelled' });

    let refund = null;
    try {
      refund = await this.refunds.createRefund({
        bookingType: 'hotel', bookingId: id, reason: 'user_cancellation', requestedBy: userId,
      });
    } catch (e) {
      this.logger.error(`Refund failed for hotel booking ${id}: ${(e as Error).message}`);
    }

    try {
      await this.notifications.notify({
        userId, type: 'booking_cancelled', title: 'Hotel reservation cancelled',
        message: 'Your hotel reservation was cancelled.',
        data: { bookingType: 'hotel', bookingId: id },
      });
    } catch (e) {
      this.logger.error(`Notification failed: ${(e as Error).message}`);
    }
    return { bookingId: id, status: BookingStatus.CANCELLED, refund };
  }
}
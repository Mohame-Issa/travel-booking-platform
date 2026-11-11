import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { BookingStatus, type BookingType } from '../common/interfaces/index.js';
import {
  type BookingPaymentReader,
  type BookingPaymentSnapshot,
  type BookingPolicies,
  FLIGHT_BOOKING_PAYMENT_READER,
  HOTEL_BOOKING_PAYMENT_READER,
} from './booking-payment-reader.js';
import type { BookingPoliciesResponseDto } from './dto/policies.dto.js';
import {
  PolicyAcceptance,
  type PolicyAcceptanceDocument,
} from './schemas/policy-acceptance.schema.js';

/** Mongo duplicate-key error code. */
const DUPLICATE_KEY = 11000;

/**
 * PAY-02: show the provider's policies before payment and record acceptance.
 */
@Injectable()
export class PoliciesService {
  constructor(
    @InjectModel(PolicyAcceptance.name)
    private readonly acceptanceModel: Model<PolicyAcceptance>,
    @Inject(FLIGHT_BOOKING_PAYMENT_READER)
    private readonly flightReader: BookingPaymentReader,
    @Inject(HOTEL_BOOKING_PAYMENT_READER)
    private readonly hotelReader: BookingPaymentReader,
  ) {}

  /**
   * Loads a booking and checks that it belongs to the user (ACC-11).
   * Also used by PaymentsService.
   */
  async getOwnedBooking(
    userId: string,
    type: BookingType,
    bookingId: string,
  ): Promise<BookingPaymentSnapshot> {
    const reader = type === 'flight' ? this.flightReader : this.hotelReader;
    const booking = await reader.getPaymentSnapshot(bookingId);
    if (!booking) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Booking not found',
      );
    }
    if (booking.userId !== userId) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.NOT_RESOURCE_OWNER,
        'You do not have access to this booking',
      );
    }
    return booking;
  }

  /**
   * PAY-01 / GEN-11: only a Pending Payment booking inside its hold can be paid
   * (and therefore have its policies accepted).
   */
  assertPayable(booking: BookingPaymentSnapshot, now = new Date()): void {
    if (booking.status !== BookingStatus.PENDING_PAYMENT) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_NOT_PAYABLE,
        `Booking is ${booking.status}; only Pending Payment bookings can be paid`,
      );
    }
    if (!booking.holdExpiresAt || booking.holdExpiresAt <= now) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.HOLD_EXPIRED,
        'The hold on this booking has expired',
      );
    }
  }

  /** GET /api/bookings/:type/:id/policies */
  async getPolicies(
    userId: string,
    type: BookingType,
    bookingId: string,
  ): Promise<BookingPoliciesResponseDto> {
    const booking = await this.getOwnedBooking(userId, type, bookingId);
    const acceptance = await this.findAcceptance(type, bookingId);
    // Once accepted, show what the user agreed to (the snapshot).
    const policies = acceptance ? snapshotOf(acceptance) : booking.policies;
    return toResponse(type, bookingId, policies, acceptance);
  }

  /** POST /api/bookings/:type/:id/accept-policies */
  async acceptPolicies(
    userId: string,
    type: BookingType,
    bookingId: string,
  ): Promise<BookingPoliciesResponseDto> {
    const booking = await this.getOwnedBooking(userId, type, bookingId);

    // Idempotent: accepting twice keeps the FIRST timestamp.
    const existing = await this.findAcceptance(type, bookingId);
    if (existing) {
      return toResponse(type, bookingId, snapshotOf(existing), existing);
    }

    this.assertPayable(booking);

    const p = booking.policies;
    try {
      const created = await this.acceptanceModel.create({
        userId: new Types.ObjectId(userId),
        bookingType: type,
        bookingId: new Types.ObjectId(bookingId),
        acceptedAt: new Date(), // PAY-02: stored with a timestamp
        cancellationTiers: sortTiers(p.cancellationTiers),
        baggagePolicy: p.baggagePolicy,
        checkInTime: p.checkInTime,
        checkOutTime: p.checkOutTime,
      });
      return toResponse(type, bookingId, snapshotOf(created), created);
    } catch (err) {
      // Two parallel clicks: the unique index lets only one insert win.
      if ((err as { code?: number }).code === DUPLICATE_KEY) {
        const winner = await this.findAcceptance(type, bookingId);
        if (winner)
          return toResponse(type, bookingId, snapshotOf(winner), winner);
      }
      throw err;
    }
  }

  /**
   * PAY-02: "Payment is blocked until accepted". Called by PaymentsService
   * before creating a PaymentIntent.
   */
  async assertAccepted(
    type: BookingType,
    bookingId: string,
  ): Promise<PolicyAcceptanceDocument> {
    const acceptance = await this.findAcceptance(type, bookingId);
    if (!acceptance) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.POLICIES_NOT_ACCEPTED,
        'Accept the provider policies before paying',
      );
    }
    return acceptance;
  }

  findAcceptance(
    type: BookingType,
    bookingId: string,
  ): Promise<PolicyAcceptanceDocument | null> {
    return this.acceptanceModel
      .findOne({ bookingType: type, bookingId: new Types.ObjectId(bookingId) })
      .exec();
  }
}

function sortTiers<T extends { daysBefore: number }>(tiers: T[]): T[] {
  return [...tiers].sort((a, b) => a.daysBefore - b.daysBefore);
}

function snapshotOf(a: PolicyAcceptance): BookingPolicies {
  return {
    cancellationTiers: a.cancellationTiers.map((t) => ({
      daysBefore: t.daysBefore,
      refundPercentage: t.refundPercentage,
    })),
    baggagePolicy: a.baggagePolicy
      ? {
          freeBags: a.baggagePolicy.freeBags,
          maxWeightKgPerBag: a.baggagePolicy.maxWeightKgPerBag,
          extraBagPrice: a.baggagePolicy.extraBagPrice,
          maxExtraBags: a.baggagePolicy.maxExtraBags,
        }
      : null,
    checkInTime: a.checkInTime,
    checkOutTime: a.checkOutTime,
  };
}

function toResponse(
  type: BookingType,
  bookingId: string,
  policies: BookingPolicies,
  acceptance: PolicyAcceptance | null,
): BookingPoliciesResponseDto {
  return {
    bookingType: type,
    bookingId,
    cancellationTiers: sortTiers(policies.cancellationTiers),
    baggagePolicy: policies.baggagePolicy,
    checkInTime: policies.checkInTime,
    checkOutTime: policies.checkOutTime,
    accepted: acceptance !== null,
    acceptedAt: acceptance?.acceptedAt ?? null,
  };
}

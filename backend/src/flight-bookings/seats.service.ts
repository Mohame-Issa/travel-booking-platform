import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type ClientSession } from 'mongoose';
import {
  ApiException,
  CabinClass,
  CabinInventory,
  ErrorCode,
} from './flight-bookings.imports.js';
import { SeatAssignment } from './schemas/seat-assignment.schema.js';
import {
  firstFreeSeats,
  isSeatInCabin,
  SEATS_PER_ROW,
  seatNumbers,
} from './seat-map.js';

const DUPLICATE_KEY = 11000;

export interface SeatRequest {
  passportNumber: string;
  /** Chosen seat, or undefined to get the first free one. */
  seatNumber?: string;
}

/**
 * FLT-28 (bonus): seat map and seat assignment. Added by Youssef Khafagy on
 * top of Omar Hashem's flight bookings. Seat COUNTS (heldSeats/bookedSeats in
 * Yassin's CabinInventory) still decide availability (FLT-22); this service
 * only decides WHICH seat each passenger gets.
 */
@Injectable()
export class SeatsService {
  constructor(
    @InjectModel(SeatAssignment.name)
    private readonly seats: Model<SeatAssignment>,
    @InjectModel(CabinInventory.name)
    private readonly cabins: Model<CabinInventory>,
  ) {}

  /** GET /api/flights/:id/seats?cabinClass=Economy */
  async seatMap(flightId: string, cabinClass: CabinClass) {
    const cabin = await this.cabins
      .findOne({ flightId: new Types.ObjectId(flightId), cabinClass })
      .lean();
    if (!cabin)
      throw new NotFoundException(`This flight has no ${cabinClass} cabin`);
    const taken = await this.takenSeats(cabin.flightId, cabinClass);
    const rows: {
      row: number;
      seats: { seatNumber: string; available: boolean }[];
    }[] = [];
    for (const seatNumber of seatNumbers(cabin.seatCount)) {
      const row = Number(seatNumber.slice(0, -1));
      if (!rows[row - 1]) rows[row - 1] = { row, seats: [] };
      rows[row - 1].seats.push({
        seatNumber,
        available: !taken.has(seatNumber),
      });
    }
    return {
      flightId,
      cabinClass,
      seatsPerRow: SEATS_PER_ROW,
      // FLT-11 / FLT-22 counter: the number of seats that can still be booked.
      availableSeats: cabin.seatCount - cabin.bookedSeats - cabin.heldSeats,
      rows,
    };
  }

  /**
   * Checks chosen seats without reserving them (booking summary, FLT-21):
   * they must exist in the cabin, appear once, and not be taken.
   */
  async checkChoices(
    flightId: Types.ObjectId,
    cabinClass: CabinClass,
    seatCount: number,
    requests: SeatRequest[],
    session?: ClientSession,
  ): Promise<Set<string>> {
    const chosen = new Set<string>();
    for (const r of requests) {
      if (!r.seatNumber) continue;
      const s = r.seatNumber.toUpperCase();
      if (!isSeatInCabin(s, seatCount))
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.INVALID_SEAT,
          `Seat ${s} does not exist in this cabin`,
        );
      if (chosen.has(s))
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.INVALID_SEAT,
          `Seat ${s} was chosen for two passengers`,
        );
      chosen.add(s);
    }
    const taken = await this.takenSeats(flightId, cabinClass, session);
    for (const s of chosen)
      if (taken.has(s))
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.SEAT_TAKEN,
          `Seat ${s} is already taken`,
        );
    return taken;
  }

  /**
   * Gives every passenger a seat inside the caller's transaction: the chosen
   * one, or else the first free one. Returns passport -> seat. Two parallel
   * bookings of the same seat: the unique index lets only one commit.
   */
  async assign(
    session: ClientSession,
    input: {
      flightId: Types.ObjectId;
      cabinClass: CabinClass;
      ownerId: Types.ObjectId;
      requests: SeatRequest[];
    },
  ): Promise<Map<string, string>> {
    const cabin = await this.cabins
      .findOne({ flightId: input.flightId, cabinClass: input.cabinClass })
      .session(session)
      .lean();
    if (!cabin)
      throw new NotFoundException(
        `This flight has no ${input.cabinClass} cabin`,
      );
    const taken = await this.checkChoices(
      input.flightId,
      input.cabinClass,
      cabin.seatCount,
      input.requests,
      session,
    );
    for (const r of input.requests)
      if (r.seatNumber) taken.add(r.seatNumber.toUpperCase());
    const open = input.requests.filter((r) => !r.seatNumber);
    const free = firstFreeSeats(cabin.seatCount, taken, open.length);
    if (free.length < open.length)
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.SEATS_UNAVAILABLE,
        'Not enough seats left in this cabin',
      );
    const result = new Map<string, string>();
    let next = 0;
    for (const r of input.requests)
      result.set(
        r.passportNumber.toUpperCase(),
        r.seatNumber ? r.seatNumber.toUpperCase() : free[next++],
      );
    try {
      await this.seats.insertMany(
        [...result].map(([passportNumber, seatNumber]) => ({
          flightId: input.flightId,
          cabinClass: input.cabinClass,
          seatNumber,
          ownerId: input.ownerId,
          passportNumber,
        })),
        { session },
      );
    } catch (e) {
      if ((e as { code?: number }).code === DUPLICATE_KEY) throw seatTaken();
      throw e;
    }
    return result;
  }

  /** Frees every seat of a booking (or pending change). Idempotent. */
  async release(session: ClientSession, ownerId: Types.ObjectId) {
    await this.seats.deleteMany({ ownerId }).session(session);
  }

  /** A pending change (FLT-27) becomes the booking: its seats move with it. */
  async transfer(
    session: ClientSession,
    fromOwnerId: Types.ObjectId,
    toOwnerId: Types.ObjectId,
  ) {
    await this.seats
      .updateMany({ ownerId: fromOwnerId }, { $set: { ownerId: toOwnerId } })
      .session(session);
  }

  /**
   * PATCH /api/flight-bookings/:id/seats: move passengers of an existing
   * booking to other free seats. Runs inside the caller's transaction.
   */
  async reassign(
    session: ClientSession,
    input: {
      flightId: Types.ObjectId;
      cabinClass: CabinClass;
      ownerId: Types.ObjectId;
      requests: Required<SeatRequest>[];
    },
  ): Promise<Map<string, string>> {
    const passports = input.requests.map((r) => r.passportNumber.toUpperCase());
    // The passengers' current seats are about to be freed, so they may be chosen again.
    await this.seats
      .deleteMany({
        ownerId: input.ownerId,
        passportNumber: { $in: passports },
      })
      .session(session);
    return this.assign(session, input);
  }

  private async takenSeats(
    flightId: Types.ObjectId,
    cabinClass: CabinClass,
    session?: ClientSession,
  ): Promise<Set<string>> {
    const q = this.seats.find({ flightId, cabinClass }, { seatNumber: 1 });
    if (session) q.session(session);
    const rows = await q.lean();
    return new Set(rows.map((r) => r.seatNumber));
  }
}

function seatTaken() {
  return new ApiException(
    HttpStatus.CONFLICT,
    ErrorCode.SEAT_TAKEN,
    'One of the chosen seats was just taken. Please choose another seat.',
  );
}

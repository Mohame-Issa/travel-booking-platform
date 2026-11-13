import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Model, type ClientSession, type Connection } from 'mongoose';
import { PLATFORM_CURRENCY } from '../common/constants/currencies.js';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { paginate } from '../common/utils/paginate.js';
import { ProviderStatus } from '../flights/catalogue.constants.js';
import {
  dateOnly,
  invalid,
  quoteAmount,
} from '../flights/catalogue-validation.js';
import { isOccupied, parseStay } from '../hotel-bookings/booking-rules.js';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema.js';
import { City } from '../seed/schemas/reference-data.schema.js';
import { IMAGE_LIMITS } from '../uploads/image-type.js';
import { UploadsService } from '../uploads/uploads.service.js';
import {
  AvailabilityAction,
  type CreateHotelDto,
  type CreateRoomDto,
  type DateRangeDto,
  type EditAvailabilityDto,
  type HotelPoliciesDto,
  type OptionalStayQueryDto,
  type ReservationsQueryDto,
  type UpdateHotelDto,
  type UpdateRoomDto,
} from './dto/hotel.dto.js';
import { lockRooms } from './room-lock.js';
import { roomIsFree } from './room-search.js';
import { HotelPolicy } from './schemas/hotel-policy.schema.js';
import { Hotel } from './schemas/hotel.schema.js';
import {
  RoomAvailability,
  RoomAvailabilityKind,
} from './schemas/room-availability.schema.js';
import { Room } from './schemas/room.schema.js';

const conflict = (code: ErrorCode, message: string) =>
  new ApiException(HttpStatus.CONFLICT, code, message);

/** Hotel management (HTL-01..HTL-10, HTL-15, HTL-22) on Yassin's shared hotel schemas. */
@Injectable()
export class HotelsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomAvailability.name)
    private readonly availability: Model<RoomAvailability>,
    @InjectModel(HotelPolicy.name)
    private readonly policies: Model<HotelPolicy>,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    private readonly uploads: UploadsService,
  ) {}

  /** HTL-01 (admin). */
  async create(dto: CreateHotelDto) {
    await this.assertCity(dto.cityId, dto.countryCode);
    return this.hotels.create(
      Object.assign({}, dto, { currency: dto.currency ?? PLATFORM_CURRENCY }),
    );
  }

  /** HTL-02: profile, policy and, when dates are given, the free rooms. */
  async details(id: string, stay: OptionalStayQueryDto) {
    const hotel = await this.findHotel(id);
    const policy = await this.policies
      .findOne({ hotelId: hotel._id })
      .lean()
      .exec();
    const withRooms = stay.checkInDate && stay.checkOutDate;
    if (!withRooms && (stay.checkInDate || stay.checkOutDate))
      invalid(
        'Give both checkInDate and checkOutDate, or neither',
        'checkOutDate',
      );
    return Object.assign({}, hotel, {
      policy: policy
        ? {
            checkInTime: policy.checkInTime,
            checkOutTime: policy.checkOutTime,
            cancellationTiers: policy.cancellationTiers,
          }
        : null,
      ...(withRooms
        ? {
            availableRooms: await this.freeRooms(
              id,
              stay.checkInDate!,
              stay.checkOutDate!,
            ),
          }
        : {}),
    });
  }

  /** HTL-01 (moderator of this hotel): profile fields and photos (GEN-08). */
  async update(id: string, dto: UpdateHotelDto, actorId: string) {
    const hotel = await this.findHotel(id);
    const { addPhotoAssetIds = [], removePhotoUrls = [], ...profile } = dto;
    if (profile.cityId || profile.countryCode)
      await this.assertCity(
        profile.cityId ?? hotel.cityId,
        profile.countryCode ?? hotel.countryCode,
      );
    const owner = { type: 'hotel' as const, id };
    const kept = hotel.photos.filter((p) => !removePhotoUrls.includes(p));
    // GEN-08: checked before any upload is attached or detached, so a rejected edit changes nothing
    if (kept.length + addPhotoAssetIds.length > IMAGE_LIMITS.hotel)
      throw conflict(
        ErrorCode.IMAGE_LIMIT_REACHED,
        `A hotel can have at most ${IMAGE_LIMITS.hotel} photos (GEN-08)`,
      );
    for (const url of removePhotoUrls) await this.uploads.detachUrl(url, owner);
    const added: string[] = [];
    for (const assetId of addPhotoAssetIds)
      added.push(await this.uploads.attach(assetId, actorId, owner));
    const photos = [
      ...hotel.photos.filter((p) => !removePhotoUrls.includes(p)),
      ...added.filter((u) => !hotel.photos.includes(u)),
    ];
    const updated = await this.hotels
      .findByIdAndUpdate(
        id,
        { $set: { ...profile, photos } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('Hotel not found');
    return updated;
  }

  /** HTL-03 */
  async addRoom(hotelId: string, dto: CreateRoomDto) {
    await this.findHotel(hotelId);
    return this.rooms.create(Object.assign({}, dto, { hotelId }));
  }

  /** HTL-05 / HTL-06: price changes never touch existing reservations (they store their own price). */
  async updateRoom(hotelId: string, roomId: string, dto: UpdateRoomDto) {
    await this.findRoom(hotelId, roomId);
    return this.connection.transaction(async (session) => {
      await lockRooms(this.rooms, [roomId], session);
      if (dto.status === ProviderStatus.DEACTIVATED)
        await this.assertNoReservation(
          roomId,
          new Date(),
          null,
          session,
          'deactivate',
        );
      return this.rooms
        .findByIdAndUpdate(
          roomId,
          { $set: dto },
          { returnDocument: 'after', runValidators: true, session },
        )
        .lean()
        .exec();
    });
  }

  /** HTL-06: only rooms that were never reserved can be deleted. */
  async deleteRoom(hotelId: string, roomId: string) {
    await this.findRoom(hotelId, roomId);
    await this.connection.transaction(async (session) => {
      await lockRooms(this.rooms, [roomId], session);
      if (
        await this.bookings.exists({ 'rooms.roomId': roomId }).session(session)
      )
        throw conflict(
          ErrorCode.ROOM_HAS_RESERVATIONS,
          'This room has reservations; deactivate it instead (HTL-06)',
        );
      await this.availability.deleteMany({ roomId }, { session }).exec();
      await this.rooms.deleteOne({ _id: roomId }, { session }).exec();
    });
  }

  /** HTL-04: non-overlapping bookable ranges (adjacent ranges are fine). */
  async addAvailability(hotelId: string, roomId: string, dto: DateRangeDto) {
    await this.findRoom(hotelId, roomId);
    const { start, end } = range(dto);
    return this.connection.transaction(async (session) => {
      await lockRooms(this.rooms, [roomId], session);
      const overlap = await this.availability
        .exists({
          roomId,
          kind: RoomAvailabilityKind.AVAILABLE,
          startDate: { $lt: end },
          endDate: { $gt: start },
        })
        .session(session);
      if (overlap)
        throw conflict(
          ErrorCode.AVAILABILITY_OVERLAP,
          'This range overlaps an existing bookable range (HTL-04)',
        );
      const [created] = await this.availability.create(
        [
          {
            roomId,
            startDate: start,
            endDate: end,
            kind: RoomAvailabilityKind.AVAILABLE,
          },
        ],
        { session },
      );
      return created.toObject();
    });
  }

  /** HTL-05 remove bookable dates, HTL-06 block / unblock; never over a Confirmed or Pending Payment reservation. */
  async editAvailability(
    hotelId: string,
    roomId: string,
    dto: EditAvailabilityDto,
  ) {
    await this.findRoom(hotelId, roomId);
    const { start, end } = range(dto);
    await this.connection.transaction(async (session) => {
      await lockRooms(this.rooms, [roomId], session);
      if (dto.action !== AvailabilityAction.UNBLOCK)
        await this.assertNoReservation(roomId, start, end, session, dto.action);
      if (dto.action === AvailabilityAction.BLOCK)
        await this.availability.create(
          [
            {
              roomId,
              startDate: start,
              endDate: end,
              kind: RoomAvailabilityKind.BLOCKED,
            },
          ],
          { session },
        );
      else
        await this.subtract(
          roomId,
          dto.action === AvailabilityAction.REMOVE
            ? RoomAvailabilityKind.AVAILABLE
            : RoomAvailabilityKind.BLOCKED,
          start,
          end,
          session,
        );
    });
    return this.roomCalendar(roomId, start, end);
  }

  /** HTL-08: each room's Available / Booked (with reference) / Blocked ranges in a window. */
  async calendar(hotelId: string, dto: DateRangeDto) {
    await this.findHotel(hotelId);
    const { start, end } = range(dto);
    const rooms = await this.rooms
      .find({ hotelId })
      .sort({ roomNumber: 1 })
      .lean()
      .exec();
    return Promise.all(
      rooms.map(async (room) => ({
        roomId: room._id,
        roomNumber: room.roomNumber,
        type: room.type,
        status: room.status,
        ranges: await this.roomCalendar(String(room._id), start, end),
      })),
    );
  }

  /** HTL-09 / HTL-10 */
  async setPolicies(hotelId: string, dto: HotelPoliciesDto) {
    await this.findHotel(hotelId);
    return this.policies
      .findOneAndUpdate(
        { hotelId },
        { $set: dto },
        { upsert: true, returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
  }

  /** HTL-22: guest (name only), dates and status of this hotel's reservations. */
  async reservations(hotelId: string, query: ReservationsQueryDto) {
    await this.findHotel(hotelId);
    return paginate(
      this.bookings,
      { hotelId, ...(query.status ? { status: query.status } : {}) },
      {
        page: query.page,
        sort: { checkInDate: -1 },
        projection: { policy: 0 },
        populate: { path: 'userId', select: 'name' },
      },
    );
  }

  /** HTL-15: every room free for the whole stay, with its total stay price. */
  async freeRooms(hotelId: string, checkInDate: string, checkOutDate: string) {
    const hotel = await this.findHotel(hotelId);
    if (hotel.status !== ProviderStatus.ACTIVE)
      throw conflict(
        ErrorCode.PROVIDER_DEACTIVATED,
        'This hotel is not accepting reservations',
      );
    const { start, end, nights } = parseStay(checkInDate, checkOutDate);
    const rooms = await this.rooms
      .find({ hotelId, status: ProviderStatus.ACTIVE })
      .sort({ pricePerNight: 1 })
      .lean()
      .exec();
    const rows = await this.availability
      .find({
        roomId: { $in: rooms.map((r) => r._id) },
        startDate: { $lt: end },
        endDate: { $gt: start },
      })
      .lean()
      .exec();
    const now = new Date();
    return rooms
      .filter((room) =>
        roomIsFree(
          rows.filter((r) => String(r.roomId) === String(room._id)),
          start,
          end,
          now,
        ),
      )
      .map((room) => ({
        roomId: room._id,
        roomNumber: room.roomNumber,
        type: room.type,
        beds: room.beds,
        maxOccupancy: room.maxOccupancy,
        pricePerNight: room.pricePerNight,
        nights,
        totalPrice: quoteAmount(room.pricePerNight, nights),
      }));
  }

  private async roomCalendar(roomId: string, start: Date, end: Date) {
    const now = new Date();
    const rows = await this.availability
      .find({ roomId, startDate: { $lt: end }, endDate: { $gt: start } })
      .sort({ startDate: 1 })
      .lean()
      .exec();
    const live = rows.filter(
      (r) => r.kind !== RoomAvailabilityKind.HELD || isOccupied(r, now),
    );
    const refs = await this.bookings
      .find(
        { _id: { $in: live.map((r) => r.bookingId).filter(Boolean) } },
        { reference: 1, status: 1 },
      )
      .lean()
      .exec();
    return live.map((r) => {
      const booking = refs.find((b) => String(b._id) === String(r.bookingId));
      return {
        startDate: r.startDate,
        endDate: r.endDate,
        status:
          r.kind === RoomAvailabilityKind.AVAILABLE
            ? 'Available'
            : r.kind === RoomAvailabilityKind.BLOCKED
              ? 'Blocked'
              : 'Booked',
        ...(booking
          ? {
              bookingId: booking._id,
              reference: booking.reference ?? null,
              bookingStatus: booking.status,
            }
          : {}),
      };
    });
  }

  /** HTL-05/06: a Confirmed reservation or an unexpired hold in [start, end) (end null = open-ended). */
  private async assertNoReservation(
    roomId: string,
    start: Date,
    end: Date | null,
    session: ClientSession,
    action: string,
  ) {
    const rows = await this.availability
      .find({
        roomId,
        kind: { $in: [RoomAvailabilityKind.BOOKED, RoomAvailabilityKind.HELD] },
        endDate: { $gt: start },
        ...(end ? { startDate: { $lt: end } } : {}),
      })
      .session(session)
      .lean()
      .exec();
    if (rows.some((r) => isOccupied(r, new Date())))
      throw conflict(
        ErrorCode.RESERVATION_CONFLICT,
        `Cannot ${action}: it overlaps a Confirmed or Pending Payment reservation (HTL-05/06)`,
      );
  }

  /** Cuts [start, end) out of a room's rows of one kind, keeping the parts outside. */
  private async subtract(
    roomId: string,
    kind: RoomAvailabilityKind,
    start: Date,
    end: Date,
    session: ClientSession,
  ) {
    const rows = await this.availability
      .find({ roomId, kind, startDate: { $lt: end }, endDate: { $gt: start } })
      .session(session)
      .exec();
    for (const row of rows) {
      const pieces = [
        ...(row.startDate < start
          ? [{ startDate: row.startDate, endDate: start }]
          : []),
        ...(row.endDate > end
          ? [{ startDate: end, endDate: row.endDate }]
          : []),
      ];
      await row.deleteOne({ session });
      if (pieces.length)
        await this.availability.create(
          pieces.map((p) => ({ ...p, roomId, kind })),
          { session, ordered: true },
        );
    }
  }

  private async findHotel(id: string) {
    const hotel = await this.hotels.findById(id).lean().exec();
    if (!hotel) throw new NotFoundException('Hotel not found');
    return hotel;
  }

  private async findRoom(hotelId: string, roomId: string) {
    const room = await this.rooms
      .findOne({ _id: roomId, hotelId })
      .lean()
      .exec();
    if (!room) throw new NotFoundException('Room not found in this hotel');
    return room;
  }

  /** GEN-12: official city that belongs to the given country. */
  private async assertCity(cityId: string, countryCode: string) {
    const city = await this.cities.findById(cityId).lean().exec();
    if (!city || city.countryCode !== countryCode)
      invalid(
        'City is unknown or does not belong to the chosen country',
        'cityId',
      );
  }
}

/** UTC-midnight [start, end) for availability edits (HTL-04). */
function range(dto: DateRangeDto) {
  const start = dateOnly(dto.startDate);
  const end = dateOnly(dto.endDate);
  if (end <= start) invalid('endDate must be after startDate', 'endDate');
  return { start, end };
}

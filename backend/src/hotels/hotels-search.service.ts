import { Injectable } from '@nestjs/common';
import { PLATFORM_CURRENCY } from '../common/constants/currencies.js';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';
import { paginateArray } from '../common/utils/paginate.js';
import { createValidationPipe } from '../common/pipes/validation.pipe.js';
import { ProviderStatus } from '../flights/catalogue.constants.js';
import {
  dateOnly,
  invalid,
  validatePriceRange,
  validatePage,
  quoteAmount,
} from '../flights/catalogue-validation.js';
import { SortOrder } from '../flights/dto/flight.dto.js';
import { City, Country } from '../seed/schemas/reference-data.schema.js';
import { HotelSort, SearchHotelsQueryDto } from './dto/search-hotels.dto.js';
import { qualifyingRooms, roomIsFree } from './room-search.js';
import { Hotel } from './schemas/hotel.schema.js';
import { RoomAvailability } from './schemas/room-availability.schema.js';
import { Room } from './schemas/room.schema.js';

@Injectable()
export class HotelsSearchService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Room.name) private readonly roomModel: Model<Room>,
    @InjectModel(RoomAvailability.name)
    private readonly availability: Model<RoomAvailability>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectModel(Country.name) private readonly countries: Model<Country>,
  ) {}
  async search(query: SearchHotelsQueryDto) {
    query = await createValidationPipe().transform(query, {
      type: 'query',
      metatype: SearchHotelsQueryDto,
    });
    validatePage(query.page);
    if (![query.guests, query.rooms].every(Number.isSafeInteger))
      invalid(
        'Guest and room counts must be safely representable integers',
        'guests',
      );
    validatePriceRange(query.minPrice, query.maxPrice);
    if (!query.cityId && !query.countryCode)
      invalid('Choose a city or country (HTL-11)', 'cityId');
    if (query.cityId) {
      const city = await this.cities.findById(query.cityId).lean().exec();
      if (
        !city ||
        (query.countryCode && city.countryCode !== query.countryCode)
      )
        invalid(
          'City is unknown or does not belong to the chosen country',
          'cityId',
        );
    }
    if (
      query.countryCode &&
      !(await this.countries.exists({ _id: query.countryCode }))
    )
      invalid('Unknown country', 'countryCode');
    const start = dateOnly(query.checkInDate),
      end = dateOnly(query.checkOutDate);
    if (query.checkInDate < new Date().toISOString().slice(0, 10))
      invalid('Check-in date cannot be in the past', 'checkInDate');
    if (end <= start)
      invalid('Check-out must be after check-in', 'checkOutDate');
    const filter: QueryFilter<Hotel> = {
      status: ProviderStatus.ACTIVE,
      currency: PLATFORM_CURRENCY,
    }; // PAY-04
    if (query.cityId) filter.cityId = query.cityId;
    if (query.countryCode) filter.countryCode = query.countryCode;
    if (query.minRating !== undefined)
      filter.averageRating = { $gte: query.minRating }; // HTL-12: null/unrated excluded.
    const hotels = await this.hotels.find(filter).lean().exec();
    const rooms = await this.roomModel
      .find({
        hotelId: { $in: hotels.map((h) => h._id) },
        status: ProviderStatus.ACTIVE,
      })
      .lean()
      .exec();
    const ranges = await this.availability
      .find({
        roomId: { $in: rooms.map((r) => r._id) },
        startDate: { $lt: end },
        endDate: { $gt: start },
      })
      .lean()
      .exec();
    const byRoom = new Map<string, RoomAvailability[]>();
    for (const range of ranges) {
      const id = String(range.roomId);
      const entries = byRoom.get(id) ?? [];
      entries.push(range);
      byRoom.set(id, entries);
    }
    const now = new Date();
    const free = rooms.filter((room) =>
      roomIsFree(byRoom.get(String(room._id)) ?? [], start, end, now),
    );
    const nights = (+end - +start) / 86_400_000;
    const results = hotels.flatMap((hotel) => {
      const available = free.filter(
        (room) => String(room.hotelId) === String(hotel._id),
      );
      const qualifying = qualifyingRooms(available, query.rooms, query.guests);
      if (!qualifying.length) return [];
      const price = Math.min(...qualifying.map((room) => room.pricePerNight));
      if (
        (query.minPrice !== undefined && price < query.minPrice) ||
        (query.maxPrice !== undefined && price > query.maxPrice)
      )
        return [];
      return [
        Object.assign({}, hotel, {
          pricePerNight: price,
          availableRoomCount: available.length,
          nights,
          cheapestQualifyingRoomStayPrice: quoteAmount(price, nights),
        }),
      ];
    });
    const direction = query.sortOrder === SortOrder.DESC ? -1 : 1;
    results.sort((a, b) => {
      if (query.sortBy === HotelSort.RATING) {
        if (a.averageRating === null && b.averageRating !== null) return 1;
        if (b.averageRating === null && a.averageRating !== null) return -1;
      }
      return (
        direction *
          (query.sortBy === HotelSort.RATING
            ? (a.averageRating ?? 0) - (b.averageRating ?? 0)
            : a.pricePerNight - b.pricePerNight) ||
        String(a._id).localeCompare(String(b._id))
      );
    });
    return {
      ...paginateArray(results, query.page),
      ...(results.length ? {} : { message: 'No hotels found' }),
    };
  }
}

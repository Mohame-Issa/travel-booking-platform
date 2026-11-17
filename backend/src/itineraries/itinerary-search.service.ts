import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Airport } from '../airports/schemas/airport.schema.js';
import { ErrorCode } from '../common/constants/error-codes.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { SearchFlightsQueryDto, TripType } from '../flights/dto/flight.dto.js';
import { FlightsService } from '../flights/flights.service.js';
import { SearchHotelsQueryDto } from '../hotels/dto/search-hotels.dto.js';
import { HotelsSearchService } from '../hotels/hotels-search.service.js';
import { buildCityGroups } from './city-groups.js';
import type {
  ItineraryFlightSearchDto,
  ItineraryHotelSearchDto,
} from './dto/itinerary-search.dto.js';
import { dayDate, toIsoDate } from './itinerary-dates.js';
import { ItineraryDay } from './schemas/itinerary-day.schema.js';
import { Itinerary } from './schemas/itinerary.schema.js';

/**
 * Flight and hotel search from an itinerary (ITN-25, ITN-26). Fills in the
 * dates and places from the itinerary, then REUSES Yassin Shawr's searches
 * (HTL-11, FLT-11, FLT-12), which do their own validation and pagination.
 */
@Injectable()
export class ItinerarySearchService {
  constructor(
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    @InjectModel(ItineraryDay.name) private readonly days: Model<ItineraryDay>,
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
    private readonly hotels: HotelsSearchService,
    private readonly flights: FlightsService,
  ) {}

  /**
   * ITN-25: hotels for one city group. Check-in = the group's first day,
   * check-out = the day after its last day.
   */
  async hotelsForGroup(itineraryId: string, q: ItineraryHotelSearchDto) {
    const { itinerary, days } = await this.load(itineraryId);
    const groups = buildCityGroups(itinerary.startDate, days);
    const group = groups[q.group - 1];
    if (!group) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Validation failed',
        [
          {
            field: 'group',
            messages: [`this itinerary has ${groups.length} city group(s)`],
          },
        ],
      );
    }
    const checkInDate = group.startDate;
    const checkOutDate = dayDate(itinerary.startDate, group.lastDayNumber + 1);
    const query = Object.assign(new SearchHotelsQueryDto(), {
      cityId: group.cityId,
      checkInDate,
      checkOutDate,
      guests: q.guests,
      rooms: q.rooms,
      page: q.page,
    });
    return {
      group: { ...group, index: q.group },
      checkInDate,
      checkOutDate,
      results: await this.hotels.search(query),
    };
  }

  /**
   * ITN-26: flights from a chosen origin to an airport in the city of the
   * itinerary's first day. Outbound defaults to the start date, return to
   * the last day's date.
   */
  async flightsToStart(itineraryId: string, q: ItineraryFlightSearchDto) {
    const { itinerary, days } = await this.load(itineraryId);
    const firstDay = days[0];
    if (!firstDay) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        'Add a day with a city before searching flights',
      );
    }
    const cityAirports = await this.airports
      .find({ cityId: firstDay.cityId })
      .distinct('_id')
      .exec();
    const arrivalAirport = this.pickArrival(
      cityAirports,
      firstDay.cityId,
      q.arrivalAirport,
    );

    const roundTrip = q.tripType === TripType.ROUND_TRIP;
    const query = Object.assign(new SearchFlightsQueryDto(), {
      departureAirport: q.departureAirport,
      arrivalAirport,
      departureDate: q.departureDate ?? toIsoDate(itinerary.startDate),
      tripType: q.tripType,
      ...(roundTrip
        ? {
            returnDate:
              q.returnDate ??
              dayDate(itinerary.startDate, days.at(-1)!.dayNumber),
          }
        : {}),
      adults: q.adults,
      children: q.children,
      infants: q.infants,
      ...(q.cabinClass ? { cabinClass: q.cabinClass } : {}),
      sortBy: q.sortBy,
      page: q.page,
    });
    return {
      arrivalAirport,
      cityId: firstDay.cityId,
      results: await this.flights.search(query),
    };
  }

  private pickArrival(
    cityAirports: string[],
    cityId: string,
    wanted?: string,
  ): string {
    if (cityAirports.length === 0) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        `No airport in ${cityId}`,
      );
    }
    if (wanted) {
      if (!cityAirports.includes(wanted)) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          'Validation failed',
          [
            {
              field: 'arrivalAirport',
              messages: [
                `must be one of ${cityAirports.join(', ')} (airports of ${cityId})`,
              ],
            },
          ],
        );
      }
      return wanted;
    }
    if (cityAirports.length > 1) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Validation failed',
        [
          {
            field: 'arrivalAirport',
            messages: [
              `${cityId} has several airports, choose one of ${cityAirports.join(', ')}`,
            ],
          },
        ],
      );
    }
    return cityAirports[0];
  }

  private async load(itineraryId: string) {
    const itinerary = await this.itineraries
      .findById(itineraryId)
      .lean()
      .exec();
    if (!itinerary) throw new NotFoundException('Itinerary not found');
    const days = await this.days
      .find({ itineraryId: itinerary._id })
      .sort({ dayNumber: 1 })
      .lean()
      .exec();
    return { itinerary, days };
  }
}

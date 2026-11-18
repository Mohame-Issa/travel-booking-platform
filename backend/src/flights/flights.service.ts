import {
  Injectable,
  Inject,
  HttpStatus,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type ClientSession, type QueryFilter } from 'mongoose';
import { AirportsService } from '../airports/airports.service.js';
import { Airline } from '../airlines/schemas/airline.schema.js';
import { AirlinesService } from '../airlines/airlines.service.js';
import { ProviderType } from '../common/constants/roles.js';
import { PLATFORM_CURRENCY } from '../common/constants/currencies.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { paginateArray } from '../common/utils/paginate.js';
import { createValidationPipe } from '../common/pipes/validation.pipe.js';
import { ModeratorAssignmentsService } from '../users/moderator-assignments.service.js';
import { FlightStatus, ProviderStatus } from './catalogue.constants.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { ErrorCode } from '../common/constants/error-codes.js';
import {
  FLIGHT_BOOKING_HISTORY_READER,
  type FlightBookingHistoryReader,
} from './flight-booking-history.interface.js';
import {
  conflict,
  invalid,
  localDateTime,
  localToUtc,
  validatePriceRange,
  validatePage,
  quoteAmount,
} from './catalogue-validation.js';
import {
  CreateCabinDto,
  CreateFlightDto,
  FlightOptionResponseDto,
  FlightSort,
  SearchFlightsQueryDto,
  SortOrder,
  TripType,
  UpdateCabinDto,
  UpdateFlightDto,
} from './dto/flight.dto.js';
import {
  FLIGHT_CANCELLED,
  FLIGHT_UPDATED,
  FlightEventsService,
} from './flight-events.service.js';
import { FlightEvent } from './schemas/flight-event.schema.js';
import { CabinInventory } from './schemas/cabin-inventory.schema.js';
import { Flight } from './schemas/flight.schema.js';

@Injectable()
export class FlightsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(FlightsService.name);
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(CabinInventory.name)
    private readonly cabins: Model<CabinInventory>,
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
    @InjectModel(FlightEvent.name) private readonly outbox: Model<FlightEvent>,
    private readonly airports: AirportsService,
    private readonly airlines: AirlinesService,
    private readonly assignments: ModeratorAssignmentsService,
    private readonly events: FlightEventsService,
    @Inject(FLIGHT_BOOKING_HISTORY_READER)
    private readonly historyReader: FlightBookingHistoryReader,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.markDeparted().catch(() =>
        this.logger.warn('Flight status update deferred'),
      );
    }, 30_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async markDeparted() {
    // FLT-30: persisted by the worker; query predicates also enforce the cutoff immediately.
    await this.flights
      .updateMany(
        { status: FlightStatus.SCHEDULED, departureTime: { $lte: new Date() } },
        { $set: { status: FlightStatus.DEPARTED } },
      )
      .exec();
  }
  private validateSchedule(
    origin: string,
    destination: string,
    departure: Date,
    arrival: Date,
  ) {
    if (origin === destination)
      invalid(
        'Departure and arrival airports must differ (FLT-03)',
        'arrivalAirport',
      );
    if (departure <= new Date())
      invalid('Departure must be in the future (FLT-03)', 'departureLocal');
    if (arrival <= departure)
      invalid(
        'Arrival must be after departure in UTC (FLT-03)',
        'arrivalLocal',
      );
  }
  async create(dto: CreateFlightDto, user: AuthenticatedUser) {
    await this.assignments.assertCanManage(
      user,
      ProviderType.AIRLINE,
      dto.airlineId,
    );
    await this.airlines.assertActive(dto.airlineId);
    const [origin, destination] = await Promise.all([
      this.airports.get(dto.departureAirport),
      this.airports.get(dto.arrivalAirport),
    ]);
    const departureTime = localToUtc(dto.departureLocal, origin.timeZone),
      arrivalTime = localToUtc(dto.arrivalLocal, destination.timeZone);
    this.validateSchedule(
      dto.departureAirport,
      dto.arrivalAirport,
      departureTime,
      arrivalTime,
    );
    return this.flights.create({
      airlineId: dto.airlineId,
      flightNumber: dto.flightNumber,
      departureAirport: dto.departureAirport,
      arrivalAirport: dto.arrivalAirport,
      departureTime,
      arrivalTime,
      departureDate: dto.departureLocal.slice(0, 10),
    });
  }
  private async managed(id: string, user: AuthenticatedUser) {
    const flight = await this.flights.findById(id).exec();
    if (!flight) throw new NotFoundException('Flight not found');
    await this.assignments.assertCanManage(
      user,
      ProviderType.AIRLINE,
      String(flight.airlineId),
    );
    if (
      flight.status === FlightStatus.SCHEDULED &&
      flight.departureTime <= new Date()
    ) {
      await this.flights.updateOne(
        {
          _id: id,
          status: FlightStatus.SCHEDULED,
          departureTime: { $lte: new Date() },
        },
        { $set: { status: FlightStatus.DEPARTED } },
      );
      conflict('Flight has departed (FLT-30)');
    }
    return flight;
  }
  private async touchScheduled(id: string, session: ClientSession) {
    const changed = await this.flights
      .updateOne(
        {
          _id: id,
          status: FlightStatus.SCHEDULED,
          departureTime: { $gt: new Date() },
        },
        { $inc: { inventoryRevision: 1 } },
        { session },
      )
      .exec();
    if (!changed.matchedCount)
      conflict('Only future Scheduled flights can be changed (FLT-30)');
  }
  async update(id: string, dto: UpdateFlightDto, user: AuthenticatedUser) {
    const flight = await this.managed(id, user);
    if (flight.status !== FlightStatus.SCHEDULED)
      conflict('Only Scheduled flights can be changed');
    if (!Object.keys(dto).length) invalid('Supply at least one schedule field');
    const departureAirport = dto.departureAirport ?? flight.departureAirport;
    const arrivalAirport = dto.arrivalAirport ?? flight.arrivalAirport;
    const airportsChanged =
      departureAirport !== flight.departureAirport ||
      arrivalAirport !== flight.arrivalAirport;
    if (
      (departureAirport !== flight.departureAirport &&
        dto.departureLocal === undefined) ||
      (arrivalAirport !== flight.arrivalAirport &&
        dto.arrivalLocal === undefined)
    )
      invalid('Supply the corresponding local time when changing an airport');
    const [origin, destination] = await Promise.all([
      this.airports.get(departureAirport),
      this.airports.get(arrivalAirport),
    ]);
    const departureTime =
      dto.departureLocal === undefined
        ? flight.departureTime
        : localToUtc(dto.departureLocal, origin.timeZone);
    const arrivalTime =
      dto.arrivalLocal === undefined
        ? flight.arrivalTime
        : localToUtc(dto.arrivalLocal, destination.timeZone);
    this.validateSchedule(
      departureAirport,
      arrivalAirport,
      departureTime,
      arrivalTime,
    );
    const updated = await this.flights.db.transaction(async (session) => {
      const filter: QueryFilter<Flight> = {
        _id: id,
        status: FlightStatus.SCHEDULED,
        departureTime: { $gt: new Date() },
        inventoryRevision: flight.inventoryRevision,
      };
      // An existing Phase 1 record may predate this counter. $inc initializes it atomically.
      if (flight.inventoryRevision === 0) {
        delete filter.inventoryRevision;
        filter.$or = [
          { inventoryRevision: 0 },
          { inventoryRevision: { $exists: false } },
        ];
      }
      let initializeBookingCount = false;
      if (airportsChanged) {
        filter.bookingCount = 0;
        const occupied = await this.cabins
          .exists({
            flightId: id,
            $or: [{ bookedSeats: { $gt: 0 } }, { heldSeats: { $gt: 0 } }],
          })
          .session(session);
        if (occupied || flight.bookingCount > 0)
          conflict('Airports cannot change after any booking (FLT-05)');
        // Hydration defaults must not turn an absent lifetime counter into proof of no history.
        const missingCount = await this.flights
          .exists({ _id: id, bookingCount: { $exists: false } })
          .session(session);
        if (missingCount) {
          const history = await this.historyReader.hasAnyBooking(id, session);
          if (history === null)
            throw new ApiException(
              HttpStatus.NOT_IMPLEMENTED,
              ErrorCode.NOT_IMPLEMENTED,
              'Legacy flight booking history must be verified before changing airports; the booking-history adapter is not integrated',
            );
          if (history)
            conflict('Airports cannot change after any booking (FLT-05)');
          filter.bookingCount = { $exists: false };
          initializeBookingCount = true;
        }
      }
      const result = await this.flights
        .findOneAndUpdate(
          filter,
          {
            $set: {
              departureAirport,
              arrivalAirport,
              departureTime,
              arrivalTime,
              ...(initializeBookingCount ? { bookingCount: 0 } : {}),
              departureDate: localDateTime(
                departureTime,
                origin.timeZone,
              ).slice(0, 10),
            },
            $inc: { inventoryRevision: 1 },
          },
          { returnDocument: 'after', runValidators: true, session },
        )
        .exec();
      if (!result) conflict('Flight changed concurrently; reload and retry');
      if (
        +flight.departureTime !== +result.departureTime ||
        +flight.arrivalTime !== +result.arrivalTime
      ) {
        await this.outbox.create(
          [
            {
              topic: FLIGHT_UPDATED,
              flightId: id,
              payload: {
                flightId: id,
                airlineId: String(flight.airlineId),
                occurredAt: new Date().toISOString(),
                previousDepartureTime: flight.departureTime.toISOString(),
                previousArrivalTime: flight.arrivalTime.toISOString(),
                departureTime: result.departureTime.toISOString(),
                arrivalTime: result.arrivalTime.toISOString(),
              },
            },
          ],
          { session },
        );
      }
      return result;
    });
    await this.dispatchCommittedEvents();
    return updated;
  }
  async cancel(id: string, user: AuthenticatedUser) {
    const flight = await this.managed(id, user);
    if (flight.status === FlightStatus.CANCELLED) return flight; // Retry-safe; its event is already durable.
    if (flight.status !== FlightStatus.SCHEDULED)
      conflict('Only Scheduled flights can be cancelled');
    const updated = await this.flights.db.transaction(async (session) => {
      const result = await this.flights
        .findOneAndUpdate(
          {
            _id: id,
            status: FlightStatus.SCHEDULED,
            departureTime: { $gt: new Date() },
          },
          {
            $set: { status: FlightStatus.CANCELLED },
            $inc: { inventoryRevision: 1 },
          },
          { returnDocument: 'after', session },
        )
        .exec();
      if (!result) conflict('Flight changed concurrently; reload and retry');
      await this.outbox.create(
        [
          {
            topic: FLIGHT_CANCELLED,
            flightId: id,
            payload: {
              flightId: id,
              airlineId: String(flight.airlineId),
              occurredAt: new Date().toISOString(),
            },
          },
        ],
        { session },
      );
      return result;
    });
    await this.dispatchCommittedEvents();
    return updated;
  }
  private async dispatchCommittedEvents(): Promise<void> {
    try {
      await this.events.dispatchPending();
    } catch {
      this.logger.warn(
        'Flight change committed; persisted events await dispatcher recovery',
      );
    }
  }
  async createCabin(id: string, dto: CreateCabinDto, user: AuthenticatedUser) {
    const flight = await this.managed(id, user);
    await this.airlines.assertCurrency(String(flight.airlineId));
    return this.flights.db.transaction(async (session) => {
      await this.touchScheduled(id, session);
      const [cabin] = await this.cabins.create(
        [Object.assign({}, dto, { flightId: id })],
        { session },
      );
      return cabin;
    });
  }
  async updateCabin(
    id: string,
    cabinId: string,
    dto: UpdateCabinDto,
    user: AuthenticatedUser,
  ) {
    const flight = await this.managed(id, user);
    await this.airlines.assertCurrency(String(flight.airlineId));
    if (!Object.keys(dto).length) invalid('Supply at least one cabin field');
    return this.flights.db.transaction(async (session) => {
      await this.touchScheduled(id, session);
      const filter: QueryFilter<CabinInventory> = {
        _id: cabinId,
        flightId: id,
      };
      // FLT-05: predicate and capacity update are one database operation, not a read/save check.
      if (dto.seatCount !== undefined)
        filter.$expr = {
          $lte: [{ $add: ['$bookedSeats', '$heldSeats'] }, dto.seatCount],
        };
      const cabin = await this.cabins
        .findOneAndUpdate(
          filter,
          { $set: dto },
          { returnDocument: 'after', runValidators: true, session },
        )
        .exec();
      if (!cabin) {
        if (
          !(await this.cabins
            .exists({ _id: cabinId, flightId: id })
            .session(session))
        )
          throw new NotFoundException('Cabin not found on this flight');
        conflict('Seat count cannot be below booked plus held seats (FLT-05)');
      }
      return cabin;
    });
  }
  async details(id: string) {
    await this.markDeparted();
    const flight = await this.flights.findById(id).lean().exec();
    if (!flight) throw new NotFoundException('Flight not found');
    const [airline, origin, destination, cabins, policy] = await Promise.all([
      // ACC-15: a deactivated airline's flights are hidden (assertActive also checks currency).
      this.airlines.assertActive(String(flight.airlineId)),
      this.airports.get(flight.departureAirport),
      this.airports.get(flight.arrivalAirport),
      this.cabins
        .find({ flightId: id })
        .sort({ price: 1, _id: 1 })
        .lean()
        .exec(),
      this.airlines.policy(String(flight.airlineId)),
    ]);
    return Object.assign({}, flight, {
      airline,
      origin,
      destination,
      departureLocal: localDateTime(flight.departureTime, origin.timeZone),
      arrivalLocal: localDateTime(flight.arrivalTime, destination.timeZone),
      durationMinutes: (+flight.arrivalTime - +flight.departureTime) / 60_000,
      cabins: cabins.map((cabin) =>
        Object.assign({}, cabin, {
          seatsRemaining: Math.max(
            0,
            cabin.seatCount - cabin.bookedSeats - cabin.heldSeats,
          ),
        }),
      ),
      policy,
    });
  }
  async search(query: SearchFlightsQueryDto) {
    // Nada's internal callers receive the same defaults and validation as HTTP consumers.
    query = await createValidationPipe().transform(query, {
      type: 'query',
      metatype: SearchFlightsQueryDto,
    });
    validatePage(query.page);
    validatePriceRange(query.minPrice, query.maxPrice);
    if (query.departureAirport === query.arrivalAirport)
      invalid('Departure and arrival airports must differ');
    const [origin] = await Promise.all([
      this.airports.get(query.departureAirport),
      this.airports.get(query.arrivalAirport),
    ]);
    if (
      ![
        query.adults,
        query.children,
        query.infants,
        query.adults + query.children,
      ].every(Number.isSafeInteger)
    )
      invalid(
        'Passenger counts must be safely representable integers',
        'adults',
      );
    if (query.adults < 1 || query.infants > query.adults)
      invalid(
        'At least one adult is required and infants cannot exceed adults (FLT-12)',
        'infants',
      );
    if (
      query.departureDate <
      localDateTime(new Date(), origin.timeZone).slice(0, 10)
    )
      invalid('Departure date cannot be in the past', 'departureDate');
    if (
      query.tripType === TripType.ROUND_TRIP &&
      (!query.returnDate || query.returnDate < query.departureDate)
    )
      invalid(
        'Round-trip returnDate is required and must not precede departureDate',
        'returnDate',
      );
    if (query.tripType === TripType.ONE_WAY && query.returnDate)
      invalid('returnDate requires tripType=round-trip', 'returnDate');
    await this.markDeparted();
    const outbound = await this.searchLeg(
      query.departureAirport,
      query.arrivalAirport,
      query.departureDate,
      query,
    );
    const inbound =
      query.tripType === TripType.ROUND_TRIP
        ? await this.searchLeg(
            query.arrivalAirport,
            query.departureAirport,
            query.returnDate!,
            query,
          )
        : undefined;
    const page = (items: FlightOptionResponseDto[]) => ({
      ...paginateArray(items, query.page),
      ...(items.length ? {} : { message: 'No flights found' }),
    });
    return {
      tripType: query.tripType,
      passengers: {
        adults: query.adults,
        children: query.children,
        infants: query.infants,
        seatsRequired: query.adults + query.children,
      },
      outbound: page(outbound),
      ...(inbound ? { return: page(inbound) } : {}),
    };
  }
  private async searchLeg(
    originCode: string,
    destinationCode: string,
    date: string,
    query: SearchFlightsQueryDto,
  ): Promise<FlightOptionResponseDto[]> {
    const airlineFilter: QueryFilter<Airline> = {
      status: ProviderStatus.ACTIVE,
      currency: PLATFORM_CURRENCY, // PAY-04: never compare or relabel legacy foreign-currency fares.
    };
    const airlines = await this.airlineModel.find(airlineFilter).lean().exec();
    const flightQuery = this.flights.find({
      airlineId: { $in: airlines.map((a) => a._id) },
      departureAirport: originCode,
      arrivalAirport: destinationCode,
      departureDate: date,
      status: FlightStatus.SCHEDULED,
      departureTime: { $gt: new Date() },
    });
    const flights = await flightQuery.lean().exec();
    const filter: QueryFilter<CabinInventory> = {
      flightId: { $in: flights.map((f) => f._id) },
      $expr: {
        $gte: [
          {
            $subtract: ['$seatCount', { $add: ['$bookedSeats', '$heldSeats'] }],
          },
          query.adults + query.children,
        ],
      },
    };
    if (query.cabinClass) filter.cabinClass = query.cabinClass;
    if (query.minPrice !== undefined || query.maxPrice !== undefined)
      filter.price = {
        ...(query.minPrice !== undefined ? { $gte: query.minPrice } : {}),
        ...(query.maxPrice !== undefined ? { $lte: query.maxPrice } : {}),
      };
    const cabins = await this.cabins.find(filter).lean().exec();
    const airlineMap = new Map(
      airlines.map((airline) => [String(airline._id), airline]),
    );
    const flightMap = new Map(
      flights.map((flight) => [String(flight._id), flight]),
    );
    const [origin, destination] = await Promise.all([
      this.airports.get(originCode),
      this.airports.get(destinationCode),
    ]);
    const results = cabins.map((cabin) => {
      const flight = flightMap.get(String(cabin.flightId))!,
        airline = airlineMap.get(String(flight.airlineId))!;
      return {
        flightId: String(flight._id),
        cabinId: String(cabin._id),
        flightNumber: flight.flightNumber,
        airline: Object.assign({}, airline, { _id: String(airline._id) }),
        origin,
        destination,
        departureTime: flight.departureTime,
        arrivalTime: flight.arrivalTime,
        departureLocal: localDateTime(flight.departureTime, origin.timeZone),
        arrivalLocal: localDateTime(flight.arrivalTime, destination.timeZone),
        durationMinutes: (+flight.arrivalTime - +flight.departureTime) / 60_000,
        cabinClass: cabin.cabinClass,
        seatsRemaining: cabin.seatCount - cabin.bookedSeats - cabin.heldSeats,
        price: cabin.price,
        currency: airline.currency,
        totalPrice: quoteAmount(
          cabin.price,
          query.adults + query.children,
          query.infants,
        ),
        freeBaggage: cabin.freeBaggage,
        maxBagWeightKg: cabin.maxBagWeightKg,
      };
    });
    const direction = query.sortOrder === SortOrder.DESC ? -1 : 1;
    results.sort(
      (a, b) =>
        direction *
          (query.sortBy === FlightSort.DURATION
            ? a.durationMinutes - b.durationMinutes
            : query.sortBy === FlightSort.DEPARTURE
              ? +a.departureTime - +b.departureTime
              : a.price - b.price) ||
        a.flightId.localeCompare(b.flightId) ||
        a.cabinId.localeCompare(b.cabinId),
    );
    return results;
  }
}

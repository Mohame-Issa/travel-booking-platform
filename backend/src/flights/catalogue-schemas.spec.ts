import { createConnection, Types } from 'mongoose';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema.js';
import {
  AirlinePolicy,
  AirlinePolicySchema,
} from '../airlines/schemas/airline-policy.schema.js';
import { Airport, AirportSchema } from '../airports/schemas/airport.schema.js';
import { Hotel, HotelSchema } from '../hotels/schemas/hotel.schema.js';
import {
  HotelPolicy,
  HotelPolicySchema,
} from '../hotels/schemas/hotel-policy.schema.js';
import { Room, RoomSchema } from '../hotels/schemas/room.schema.js';
import {
  RoomAvailability,
  RoomAvailabilityKind,
  RoomAvailabilitySchema,
} from '../hotels/schemas/room-availability.schema.js';
import {
  CabinInventory,
  CabinInventorySchema,
} from './schemas/cabin-inventory.schema.js';
import { Flight, FlightSchema } from './schemas/flight.schema.js';
import {
  CabinClass,
  FlightStatus,
  ProviderStatus,
} from './catalogue.constants.js';

// Schema validation does not connect to any database.
const connection = createConnection();
const Airlines = connection.model(Airline.name, AirlineSchema);
const Airports = connection.model(Airport.name, AirportSchema);
const Flights = connection.model(Flight.name, FlightSchema);
const Cabins = connection.model(CabinInventory.name, CabinInventorySchema);
const AirlinePolicies = connection.model(
  AirlinePolicy.name,
  AirlinePolicySchema,
);
const Hotels = connection.model(Hotel.name, HotelSchema);
const Rooms = connection.model(Room.name, RoomSchema);
const Availability = connection.model(
  RoomAvailability.name,
  RoomAvailabilitySchema,
);
const HotelPolicies = connection.model(HotelPolicy.name, HotelPolicySchema);
const providerId = new Types.ObjectId();
const validFlight = {
  airlineId: providerId,
  flightNumber: 'YS100',
  departureAirport: 'CAI',
  arrivalAirport: 'DXB',
  departureTime: new Date('2099-12-01T08:00Z'),
  arrivalTime: new Date('2099-12-01T11:00Z'),
  departureDate: '2099-12-01',
};
const validCabin = {
  flightId: providerId,
  cabinClass: CabinClass.ECONOMY,
  seatCount: 10,
  price: 100,
  freeBaggage: 1,
  maxBagWeightKg: 23,
};

describe('Flight catalogue schemas (FLT-01/03/04/05/08/09/30)', () => {
  it('uses real ObjectId schema paths rather than Mixed references', () => {
    for (const [model, field] of [
      [Flights, 'airlineId'],
      [Cabins, 'flightId'],
      [AirlinePolicies, 'airlineId'],
      [Rooms, 'hotelId'],
      [Availability, 'roomId'],
      [Availability, 'bookingId'],
      [HotelPolicies, 'hotelId'],
    ] as const) {
      const schemaPath = model.schema.paths[field];
      expect(schemaPath?.instance).toBe('ObjectId');
    }
  });
  it('defaults providers to active, flights to Scheduled and cabin counts to zero', async () => {
    const airline = new Airlines({ name: 'Test', code: 'YS', currency: 'EGP' });
    const flight = new Flights(validFlight),
      cabin = new Cabins(validCabin);
    await Promise.all([
      airline.validate(),
      flight.validate(),
      cabin.validate(),
    ]);
    expect(airline.status).toBe(ProviderStatus.ACTIVE);
    expect(flight.status).toBe(FlightStatus.SCHEDULED);
    expect(cabin.bookedSeats).toBe(0);
    expect(cabin.heldSeats).toBe(0);
  });
  it('rejects identical airports and reversed UTC times', async () => {
    await expect(
      new Flights({ ...validFlight, arrivalAirport: 'CAI' }).validate(),
    ).rejects.toThrow();
    await expect(
      new Flights({
        ...validFlight,
        arrivalTime: validFlight.departureTime,
      }).validate(),
    ).rejects.toThrow();
  });
  it('rejects unsupported cabin names, fractional seats, invalid prices and excess inventory counts', async () => {
    for (const change of [
      { cabinClass: 'Luxury' },
      { seatCount: 0 },
      { seatCount: 1.5 },
      { bookedSeats: -1 },
      { heldSeats: 0.5 },
      { seatCount: 2, bookedSeats: 2, heldSeats: 1 },
      { price: 0 },
      { freeBaggage: 1.5 },
      { maxBagWeightKg: 0 },
    ])
      await expect(
        new Cabins({ ...validCabin, ...change }).validate(),
      ).rejects.toThrow();
  });
  it('rejects duplicate tier thresholds and invalid extra-bag rules', async () => {
    await expect(
      new AirlinePolicies({
        airlineId: providerId,
        cancellationTiers: [
          { daysBefore: 0, refundPercentage: 20 },
          { daysBefore: 0, refundPercentage: 50 },
        ],
      }).validate(),
    ).rejects.toThrow();
    for (const change of [
      { extraBagPrice: 0 },
      { maxExtraBags: -1 },
      { maxExtraBags: 0.5 },
      { cancellationTiers: [{ daysBefore: -1, refundPercentage: 101 }] },
    ])
      await expect(
        new AirlinePolicies({ airlineId: providerId, ...change }).validate(),
      ).rejects.toThrow();
  });
  it('preserves IATA primary keys and validates IANA time zones', async () => {
    const airport = {
      _id: 'CAI',
      iataCode: 'CAI',
      name: 'Cairo',
      cityId: 'cairo',
      countryCode: 'EG',
      timeZone: 'Africa/Cairo',
    };
    await expect(new Airports(airport).validate()).resolves.toBeUndefined();
    await expect(
      new Airports({ ...airport, iataCode: 'DXB' }).validate(),
    ).rejects.toThrow();
    await expect(
      new Airports({ ...airport, timeZone: 'Invalid/Zone' }).validate(),
    ).rejects.toThrow();
  });
});

describe('Shared hotel schemas (HTL-03/04/10/11/12)', () => {
  const hotel = {
    name: 'Hotel',
    address: 'Cairo',
    cityId: 'cairo',
    countryCode: 'EG',
    starClass: 3,
    currency: 'EGP',
  };
  it('distinguishes unrated hotels from rated ones and validates currency/status/rating', async () => {
    const doc = new Hotels(hotel);
    await doc.validate();
    expect(doc.averageRating).toBeNull();
    expect(doc.ratingCount).toBe(0);
    expect(doc.status).toBe(ProviderStatus.ACTIVE);
    for (const change of [
      { averageRating: 0 },
      { averageRating: 6 },
      { starClass: 3.5 },
      { currency: 'ZZZ' },
      { status: 'hidden' },
    ])
      await expect(
        new Hotels({ ...hotel, ...change }).validate(),
      ).rejects.toThrow();
  });
  it('requires individual room capacity and positive nightly rates', async () => {
    const room = {
      hotelId: providerId,
      roomNumber: '101',
      type: 'Double',
      beds: 2,
      maxOccupancy: 2,
      pricePerNight: 100,
    };
    await expect(new Rooms(room).validate()).resolves.toBeUndefined();
    for (const change of [
      { maxOccupancy: 0 },
      { beds: 1.5 },
      { pricePerNight: 0 },
    ])
      await expect(
        new Rooms({ ...room, ...change }).validate(),
      ).rejects.toThrow();
  });
  it('validates half-open date-only ranges without implementing reservations', async () => {
    const range = {
      roomId: providerId,
      startDate: new Date('2099-12-01T00:00Z'),
      endDate: new Date('2099-12-03T00:00Z'),
      kind: RoomAvailabilityKind.AVAILABLE,
    };
    await expect(new Availability(range).validate()).resolves.toBeUndefined();
    await expect(
      new Availability({ ...range, endDate: range.startDate }).validate(),
    ).rejects.toThrow();
    await expect(
      new Availability({
        ...range,
        startDate: new Date('2099-12-01T01:00Z'),
      }).validate(),
    ).rejects.toThrow();
  });
  it('validates local hotel policy times and unique cancellation tiers', async () => {
    const policy = {
      hotelId: providerId,
      checkInTime: '14:00',
      checkOutTime: '11:00',
    };
    await expect(new HotelPolicies(policy).validate()).resolves.toBeUndefined();
    await expect(
      new HotelPolicies({ ...policy, checkInTime: '24:00' }).validate(),
    ).rejects.toThrow();
    await expect(
      new HotelPolicies({
        ...policy,
        cancellationTiers: [
          { daysBefore: 0, refundPercentage: 20 },
          { daysBefore: 0, refundPercentage: 50 },
        ],
      }).validate(),
    ).rejects.toThrow();
  });
});

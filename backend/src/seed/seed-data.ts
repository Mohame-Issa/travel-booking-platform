import { hash } from 'bcryptjs';
import type { Connection } from 'mongoose';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema.js';
import { Airport, AirportSchema } from '../airports/schemas/airport.schema.js';
import { ProviderType, UserRole } from '../common/constants/roles.js';
import { Hotel, HotelSchema } from '../hotels/schemas/hotel.schema.js';
import {
  ModeratorAssignment,
  ModeratorAssignmentSchema,
} from '../users/schemas/moderator-assignment.schema.js';
import { User, UserSchema } from '../users/schemas/user.schema.js';
import { validateReferenceData, type ReferenceData } from './reference-data.js';
import {
  validateSeedOptions,
  type SeedAccount,
  type SeedOptions,
} from './seed-options.js';
import {
  Attraction,
  AttractionSchema,
  City,
  CitySchema,
  Country,
  CountrySchema,
} from './schemas/reference-data.schema.js';

/** Caller supplies the connection explicitly. This function never reads an environment file. */
export async function seedData(
  connection: Connection,
  data: ReferenceData,
  options: SeedOptions = {},
) {
  validateReferenceData(data);
  validateSeedOptions(options);
  const countries = connection.model(Country.name, CountrySchema);
  const cities = connection.model(City.name, CitySchema);
  const airports = connection.model(Airport.name, AirportSchema);
  const attractions = connection.model(Attraction.name, AttractionSchema);
  // Reuse the exact shared schemas; never create separate user or assignment definitions.
  const users = connection.model(User.name, UserSchema);
  const airlines = connection.model(Airline.name, AirlineSchema);
  const hotels = connection.model(Hotel.name, HotelSchema);
  const assignments = connection.model(
    ModeratorAssignment.name,
    ModeratorAssignmentSchema,
  );
  await Promise.all([
    countries.init(),
    cities.init(),
    airports.init(),
    attractions.init(),
    users.init(),
    airlines.init(),
    hotels.init(),
    assignments.init(),
  ]);

  // Atlas supports transactions. Conflicting account roles/providers/assignments roll back all data writes.
  await connection.transaction(async (session) => {
    // GEN-12: update only official fields by original identifiers; no deletion or replacement.
    await countries.bulkWrite(
      data.countries.map((row) => ({
        updateOne: {
          filter: { _id: row.code },
          update: {
            $set: { code: row.code, name: row.name, currency: row.currency },
          },
          upsert: true,
        },
      })),
      { session },
    );
    await cities.bulkWrite(
      data.cities.map((row) => ({
        updateOne: {
          filter: { _id: row.city_id },
          update: {
            $set: {
              cityId: row.city_id,
              name: row.name,
              countryCode: row.country_code,
            },
          },
          upsert: true,
        },
      })),
      { session },
    );
    await airports.bulkWrite(
      data.airports.map((row) => ({
        updateOne: {
          filter: { _id: row.iata_code },
          update: {
            $set: {
              iataCode: row.iata_code,
              name: row.name,
              cityId: row.city_id,
              countryCode: row.country_code,
              timeZone: row.time_zone,
            },
          },
          upsert: true,
        },
      })),
      { session },
    );
    await attractions.bulkWrite(
      data.attractions.map((row) => ({
        updateOne: {
          filter: { _id: row.attraction_id },
          update: {
            $set: {
              attractionId: row.attraction_id,
              name: row.name,
              cityId: row.city_id,
            },
          },
          upsert: true,
        },
      })),
      { session },
    );

    const account = async (
      input: SeedAccount,
      role: UserRole,
      name: string,
    ) => {
      const email = input.email.trim().toLowerCase();
      const existing = await users.findOne({ email }).session(session).exec();
      if (existing) {
        if (existing.role !== role)
          throw new Error(
            'Seed account email belongs to another role; no account was changed',
          );
        return existing; // ACC-18, GEN-13: preserve password, status, profile and forced-password flag.
      }
      const passwordHash = await hash(input.password, 12);
      const result = await users
        .findOneAndUpdate(
          { email },
          {
            $setOnInsert: {
              name,
              email,
              role,
              passwordHash,
              mustChangePassword: role !== UserRole.ADMIN,
            },
          },
          {
            upsert: true,
            returnDocument: 'after',
            runValidators: true,
            session,
          },
        )
        .exec();
      if (result.role !== role)
        throw new Error('Seed account conflicts with an existing role');
      return result;
    };
    if (options.admin)
      await account(options.admin, UserRole.ADMIN, 'Platform Administrator'); // ACC-18

    if (options.demo) {
      // Stable keys preserve fixture identity even after moderators rename providers or change airline codes.
      const airline = await airlines
        .findOneAndUpdate(
          { seedKey: 'yassin-demo-airline' },
          {
            $setOnInsert: {
              seedKey: 'yassin-demo-airline',
              name: 'Yassin Demo Air',
              code: 'YS',
              currency: 'EGP',
            },
          },
          {
            upsert: true,
            returnDocument: 'after',
            runValidators: true,
            session,
          },
        )
        .exec();
      const hotel = await hotels
        .findOneAndUpdate(
          { seedKey: 'yassin-demo-hotel' },
          {
            $setOnInsert: {
              seedKey: 'yassin-demo-hotel',
              name: 'Yassin Demo Hotel',
              address: 'Cairo, Egypt',
              cityId: 'cairo',
              countryCode: 'EG',
              description: 'Test provider for moderator integration',
              starClass: 3,
              currency: 'EGP',
            },
          },
          {
            upsert: true,
            returnDocument: 'after',
            runValidators: true,
            session,
          },
        )
        .exec();
      const airlineModerator = await account(
        options.demo.airlineModerator,
        UserRole.AIRLINE_MODERATOR,
        'Test Airline Moderator',
      );
      const hotelModerator = await account(
        options.demo.hotelModerator,
        UserRole.HOTEL_MODERATOR,
        'Test Hotel Moderator',
      );
      for (const [moderator, providerType, providerId] of [
        [airlineModerator, ProviderType.AIRLINE, airline._id],
        [hotelModerator, ProviderType.HOTEL, hotel._id],
      ] as const) {
        const assignment = await assignments
          .findOneAndUpdate(
            { moderatorId: moderator._id },
            {
              $setOnInsert: {
                moderatorId: moderator._id,
                providerType,
                providerId,
                assignedBy: null,
              },
            },
            {
              upsert: true,
              returnDocument: 'after',
              runValidators: true,
              session,
            },
          )
          .exec();
        if (
          assignment.providerType !== providerType ||
          String(assignment.providerId) !== String(providerId)
        )
          throw new Error(
            'Seed moderator already has another assignment; existing assignment was preserved',
          );
      }
    }
  });
  return {
    countries: data.countries.length,
    cities: data.cities.length,
    airports: data.airports.length,
    attractions: data.attractions.length,
    currencies: [...new Set(data.countries.map((row) => row.currency))].sort(),
    admin: Boolean(options.admin),
    demoModerators: Boolean(options.demo),
  };
}

// Explicitly local: never loads .env, AppModule or the shared Atlas configuration.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { compare } from 'bcryptjs';
import mongoose from 'mongoose';
import { loadReferenceData } from '../dist/seed/reference-data.js';
import { seedData } from '../dist/seed/seed-data.js';
import {
  CabinClass,
  ProviderStatus,
} from '../dist/flights/catalogue.constants.js';
import { Flight, FlightSchema } from '../dist/flights/schemas/flight.schema.js';
import {
  CabinInventory,
  CabinInventorySchema,
} from '../dist/flights/schemas/cabin-inventory.schema.js';
import { Room, RoomSchema } from '../dist/hotels/schemas/room.schema.js';

let mongo, connection, data;
const password = randomBytes(16).toString('hex') + 'A1';
const options = {
  admin: { email: 'admin@yassin-test.example', password },
  demo: {
    airlineModerator: { email: 'airline@yassin-test.example', password },
    hotelModerator: { email: 'hotel@yassin-test.example', password },
  },
};

before(
  async () => {
    mongo = await MongoMemoryReplSet.create({
      binary: { version: '8.2.6' },
      replSet: { count: 1 },
    });
    connection = await mongoose
      .createConnection(mongo.getUri('yassin_phase1_tests'))
      .asPromise();
    data = await loadReferenceData(
      new URL('../../docs/requirements/', import.meta.url),
    );
    await seedData(connection, data, options);
  },
  { timeout: 240_000 },
);

after(async () => {
  if (connection) await connection.close();
  if (mongo) await mongo.stop();
});

test('official IDs, references and supported currencies survive database seeding (GEN-12)', async () => {
  const countries = await connection.model('Country').find().lean();
  const cities = await connection.model('City').find().lean();
  const airports = await connection.model('Airport').find().lean();
  const attractions = await connection.model('Attraction').find().lean();
  assert.deepEqual(
    countries.map((row) => row._id).sort(),
    data.countries.map((row) => row.code).sort(),
  );
  assert.deepEqual(
    cities.map((row) => row._id).sort(),
    data.cities.map((row) => row.city_id).sort(),
  );
  assert.deepEqual(
    airports.map((row) => row._id).sort(),
    data.airports.map((row) => row.iata_code).sort(),
  );
  assert.deepEqual(
    attractions.map((row) => row._id).sort(),
    data.attractions.map((row) => row.attraction_id).sort(),
  );
  for (const city of cities)
    assert.ok(countries.some((country) => country._id === city.countryCode));
  for (const airport of airports)
    assert.ok(
      cities.some(
        (city) =>
          city._id === airport.cityId &&
          city.countryCode === airport.countryCode,
      ),
    );
  for (const attraction of attractions)
    assert.ok(cities.some((city) => city._id === attraction.cityId));
  assert.equal(
    airports.find((airport) => airport._id === 'CAI').timeZone,
    'Africa/Cairo',
  );
  assert.deepEqual(
    [...new Set(countries.map((country) => country.currency))].sort(),
    ['AED', 'EGP', 'EUR', 'GBP', 'JPY', 'SAR', 'USD'],
  );
});

test('seeded passwords are salted hashes; moderators have exactly one correct provider assignment (ACC-18)', async () => {
  const users = await connection
    .model('User')
    .find()
    .select('+passwordHash')
    .lean();
  const assignments = await connection
    .model('ModeratorAssignment')
    .find()
    .lean();
  assert.equal(users.length, 3);
  assert.equal(assignments.length, 2);
  for (const user of users) {
    assert.notEqual(user.passwordHash, password);
    assert.equal(await compare(password, user.passwordHash), true);
    if (user.role !== 'admin') {
      assert.equal(user.mustChangePassword, true);
      const assigned = assignments.filter(
        (assignment) => String(assignment.moderatorId) === String(user._id),
      );
      assert.equal(assigned.length, 1);
      const type = user.role === 'airline_moderator' ? 'Airline' : 'Hotel';
      assert.ok(
        await connection.model(type).exists({ _id: assigned[0].providerId }),
      );
    }
  }
  assert.notEqual(users[0].passwordHash, users[1].passwordHash);
});

test('reruns preserve IDs, changed profiles, suspended status, passwords, unrelated records and fields', async () => {
  const Users = connection.model('User'),
    Airlines = connection.model('Airline');
  const admin = await Users.findOne({ email: options.admin.email }).select(
    '+passwordHash',
  );
  const hash = admin.passwordHash;
  await Users.updateOne(
    { _id: admin._id },
    { $set: { name: 'Existing admin profile', status: 'suspended' } },
  );
  const airline = await Airlines.findOne({ seedKey: 'yassin-demo-airline' });
  await Airlines.updateOne(
    { _id: airline._id },
    {
      $set: {
        name: 'Edited provider',
        code: 'YY',
        status: ProviderStatus.DEACTIVATED,
      },
    },
  );
  await connection
    .collection('countries')
    .updateOne({ _id: 'EG' }, { $set: { extraTeamField: 'preserved' } });
  await connection.collection('unrelated').insertOne({ marker: 'keep-me' });
  const airportIds = (
    await connection.model('Airport').find().sort({ _id: 1 })
  ).map((airport) => airport._id);
  const originalAssignments = (
    await connection.model('ModeratorAssignment').find().sort({ _id: 1 })
  ).map((assignment) => assignment.toObject());
  await seedData(connection, data, {
    ...options,
    admin: {
      ...options.admin,
      password: randomBytes(16).toString('hex') + 'A1',
    },
  });
  await seedData(connection, data, options);
  const afterAdmin = await Users.findById(admin._id).select('+passwordHash');
  assert.equal(afterAdmin.passwordHash, hash);
  assert.equal(afterAdmin.name, 'Existing admin profile');
  assert.equal(afterAdmin.status, 'suspended');
  assert.equal(await Users.countDocuments(), 3);
  assert.equal(await Airlines.countDocuments(), 1);
  assert.equal((await Airlines.findById(airline._id)).code, 'YY');
  assert.equal(
    (await Airlines.findById(airline._id)).status,
    ProviderStatus.DEACTIVATED,
  );
  assert.equal(
    (await connection.collection('countries').findOne({ _id: 'EG' }))
      .extraTeamField,
    'preserved',
  );
  assert.ok(
    await connection.collection('unrelated').findOne({ marker: 'keep-me' }),
  );
  assert.deepEqual(
    (await connection.model('Airport').find().sort({ _id: 1 })).map(
      (airport) => airport._id,
    ),
    airportIds,
  );
  const afterAssignments = await connection
    .model('ModeratorAssignment')
    .find()
    .sort({ _id: 1 })
    .lean();
  assert.deepEqual(
    afterAssignments.map((a) => [
      String(a._id),
      String(a.providerId),
      String(a.moderatorId),
    ]),
    originalAssignments.map((a) => [
      String(a._id),
      String(a.providerId),
      String(a.moderatorId),
    ]),
  );
  assert.equal(
    await connection.model('Attraction').countDocuments(),
    data.attractions.length,
  );
});

test('role and assignment conflicts roll back reference changes and leave existing accounts intact', async () => {
  const before = await connection.model('Country').findById('EG').lean();
  const changed = structuredClone(data);
  changed.countries.find((country) => country.code === 'EG').name =
    'Must Roll Back';
  await assert.rejects(
    seedData(connection, changed, {
      admin: { email: options.demo.airlineModerator.email, password },
    }),
    /another role/,
  );
  assert.equal(
    (await connection.model('Country').findById('EG')).name,
    before.name,
  );
  const moderator = await connection
    .model('User')
    .findOne({ email: options.demo.airlineModerator.email });
  const assignment = await connection
    .model('ModeratorAssignment')
    .findOne({ moderatorId: moderator._id });
  const hotel = await connection
    .model('Hotel')
    .findOne({ seedKey: 'yassin-demo-hotel' });
  await connection
    .model('ModeratorAssignment')
    .updateOne({ _id: assignment._id }, { $set: { providerId: hotel._id } });
  await assert.rejects(
    seedData(connection, changed, options),
    /another assignment/,
  );
  assert.equal(
    (await connection.model('Country').findById('EG')).name,
    before.name,
  );
  assert.equal(
    String(
      (await connection.model('ModeratorAssignment').findById(assignment._id))
        .providerId,
    ),
    String(hotel._id),
  );
  // Restore only the assignment modified by this isolated test.
  await connection
    .model('ModeratorAssignment')
    .updateOne(
      { _id: assignment._id },
      { $set: { providerId: assignment.providerId } },
    );
});

test('unique airline codes, per-date flight numbers, per-flight cabins and per-hotel room numbers are enforced', async () => {
  const Flights = connection.model(Flight.name, FlightSchema);
  const Cabins = connection.model(CabinInventory.name, CabinInventorySchema);
  const Rooms = connection.model(Room.name, RoomSchema);
  await Promise.all([Flights.init(), Cabins.init(), Rooms.init()]);
  const airline = await connection
    .model('Airline')
    .findOne({ seedKey: 'yassin-demo-airline' });
  const hotel = await connection
    .model('Hotel')
    .findOne({ seedKey: 'yassin-demo-hotel' });
  await assert.rejects(
    connection
      .model('Airline')
      .create({ name: 'Duplicate', code: airline.code, currency: 'EGP' }),
    { code: 11000 },
  );
  const flightData = {
    airlineId: airline._id,
    flightNumber: 'YS100',
    departureAirport: 'CAI',
    arrivalAirport: 'DXB',
    departureTime: new Date('2099-12-01T08:00Z'),
    arrivalTime: new Date('2099-12-01T11:00Z'),
    departureDate: '2099-12-01',
  };
  const flight = await Flights.create(flightData);
  await assert.rejects(Flights.create(flightData), { code: 11000 });
  const cabin = {
    flightId: flight._id,
    cabinClass: CabinClass.ECONOMY,
    seatCount: 10,
    price: 100,
    freeBaggage: 1,
    maxBagWeightKg: 23,
  };
  await Cabins.create(cabin);
  await assert.rejects(Cabins.create(cabin), { code: 11000 });
  const room = {
    hotelId: hotel._id,
    roomNumber: '101',
    type: 'Double',
    beds: 2,
    maxOccupancy: 2,
    pricePerNight: 100,
  };
  await Rooms.create(room);
  await assert.rejects(Rooms.create(room), { code: 11000 });
  const airport = data.airports[0];
  await assert.rejects(
    connection.model('Airport').create({
      _id: airport.iata_code,
      iataCode: airport.iata_code,
      name: airport.name,
      cityId: airport.city_id,
      countryCode: airport.country_code,
      timeZone: airport.time_zone,
    }),
    { code: 11000 },
  );
});

test('malformed inputs are rejected before data writes, and CLI check never connects', async () => {
  const before = await connection.model('Country').countDocuments();
  const broken = structuredClone(data);
  broken.airports[0].city_id = 'missing';
  await assert.rejects(seedData(connection, broken, options));
  await assert.rejects(
    seedData(connection, data, {
      admin: { email: 'invalid', password: 'short' },
    }),
  );
  assert.equal(await connection.model('Country').countDocuments(), before);
  // Even an invalid target is never used in the default mode; this child does not load .env.
  const output = execFileSync(process.execPath, ['dist/seed/run-seed.js'], {
    encoding: 'utf8',
    env: { ...process.env, MONGODB_URI: 'invalid-target-not-used' },
  });
  assert.match(output, /No database connection or writes/);
  assert.doesNotMatch(output, /invalid-target-not-used/);
});

// Full HTTP feature tests against a disposable local replica set; never imports .env or AppModule.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AuthModule } from '../dist/auth/auth.module.js';
import { AuthGuard } from '../dist/auth/guards/auth.guard.js';
import { UsersModule } from '../dist/users/users.module.js';
import { RolesGuard } from '../dist/common/guards/roles.guard.js';
import { createValidationPipe } from '../dist/common/pipes/validation.pipe.js';
import { AllExceptionsFilter } from '../dist/common/filters/all-exceptions.filter.js';
import { AirlinesModule } from '../dist/airlines/airlines.module.js';
import { AirlinesService } from '../dist/airlines/airlines.service.js';
import { AirportsModule } from '../dist/airports/airports.module.js';
import { FlightsModule } from '../dist/flights/flights.module.js';
import { HotelsCatalogueModule } from '../dist/hotels/hotels-catalogue.module.js';
import { FlightEventsService } from '../dist/flights/flight-events.service.js';
import { FlightsService } from '../dist/flights/flights.service.js';
import {
  FLIGHT_BOOKING_HISTORY_READER,
  PendingFlightBookingHistoryReader,
} from '../dist/flights/flight-booking-history.interface.js';
import { HotelsSearchService } from '../dist/hotels/hotels-search.service.js';
import { loadReferenceData } from '../dist/seed/reference-data.js';
import { seedData } from '../dist/seed/seed-data.js';

let mongo, app, connection, http, admin, moderator, outsider, airline;
const password = randomBytes(16).toString('hex') + 'A1';
const nextPassword = randomBytes(16).toString('hex') + 'A1';
const options = {
  admin: { email: 'admin@yassin-test.example', password },
  demo: {
    airlineModerator: { email: 'airline@yassin-test.example', password },
    hotelModerator: { email: 'hotel@yassin-test.example', password },
  },
};
const date = '2099-12-01';
const flightBody = (number) => ({
  airlineId: airline.id,
  flightNumber: number,
  departureAirport: 'CAI',
  arrivalAirport: 'DXB',
  departureLocal: `${date}T10:00`,
  arrivalLocal: `${date}T15:00`,
});
const cabinBody = (seatCount = 5, price = 100) => ({
  cabinClass: 'Economy',
  seatCount,
  price,
  freeBaggage: 1,
  maxBagWeightKg: 23,
});
const search = (extra) => ({
  departureAirport: 'CAI',
  arrivalAirport: 'DXB',
  departureDate: date,
  ...extra,
});
const createFlight = async (number, changes = {}) =>
  (
    await moderator
      .post('/api/flights')
      .send({ ...flightBody(number), ...changes })
      .expect(201)
  ).body;
const createCabin = async (id, count = 5, price = 100) =>
  (
    await moderator
      .post(`/api/flights/${id}/cabins`)
      .send(cabinBody(count, price))
      .expect(201)
  ).body;

before(
  async () => {
    mongo = await MongoMemoryReplSet.create({
      binary: { version: '8.2.6' },
      replSet: { count: 1 },
    });
    // FlightBookingsModule (Omar) binds the real reader in the app; this test only loads the
    // catalogue, so it gets the "unknown" reader (null -> 501) its history checks expect.
    class HistoryReaderStub {}
    Module({
      providers: [
        {
          provide: FLIGHT_BOOKING_HISTORY_READER,
          useClass: PendingFlightBookingHistoryReader,
        },
      ],
      exports: [FLIGHT_BOOKING_HISTORY_READER],
    })(HistoryReaderStub);
    Global()(HistoryReaderStub);
    class TestApplication {}
    Module({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_SECRET: randomBytes(48).toString('hex'),
              COOKIE_SECURE: false,
            }),
          ],
        }),
        MongooseModule.forRoot(mongo.getUri('yassin_catalogue_http_tests')),
        UsersModule,
        AuthModule,
        AirlinesModule,
        AirportsModule,
        HistoryReaderStub,
        FlightsModule,
        HotelsCatalogueModule,
      ],
      providers: [
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    })(TestApplication);
    app = await NestFactory.create(TestApplication, { logger: false });
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    http = app.getHttpServer();
    connection = app.get(getConnectionToken());
    const data = await loadReferenceData(
      new URL('../../docs/requirements/', import.meta.url),
    );
    await seedData(connection, data, options);
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    airline = await connection
      .model('Airline')
      .findOne({ seedKey: 'yassin-demo-airline' });
    admin = request.agent(http);
    moderator = request.agent(http);
    outsider = request.agent(http);
    await admin.post('/api/auth/login').send(options.admin).expect(200);
    await moderator
      .post('/api/auth/login')
      .send(options.demo.airlineModerator)
      .expect(200);
    await moderator
      .patch('/api/auth/change-password')
      .send({ currentPassword: password, newPassword: nextPassword })
      .expect(200);
    await outsider
      .post('/api/auth/register')
      .send({
        name: 'Other User',
        email: 'other@yassin-test.example',
        password,
        acceptTerms: true,
      })
      .expect(201);
    await outsider
      .post('/api/auth/login')
      .send({ email: 'other@yassin-test.example', password })
      .expect(200);
  },
  { timeout: 240_000 },
);
after(async () => {
  if (app) await app.close();
  if (mongo) await mongo.stop();
});

test('all 14 assigned methods are wired and documented in Swagger with request/response schemas', () => {
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Catalogue test').setVersion('1').build(),
  );
  const routes = [
    ['post', '/api/airlines'],
    ['get', '/api/airlines/{id}'],
    ['patch', '/api/airlines/{id}'],
    ['get', '/api/airports'],
    ['post', '/api/flights'],
    ['get', '/api/flights/search'],
    ['get', '/api/flights/{id}'],
    ['patch', '/api/flights/{id}'],
    ['post', '/api/flights/{id}/cancel'],
    ['post', '/api/flights/{id}/cabins'],
    ['patch', '/api/flights/{id}/cabins/{cabinId}'],
    ['put', '/api/airlines/{id}/baggage-policy'],
    ['put', '/api/airlines/{id}/cancellation-policy'],
    ['get', '/api/hotels/search'],
  ];
  for (const [method, path] of routes) {
    const operation = doc.paths[path]?.[method];
    assert.ok(operation, `${method} ${path}`);
    assert.ok(
      Object.values(operation.responses).some(
        (response) => response.content?.['application/json']?.schema,
      ),
    );
    if (['post', 'patch', 'put'].includes(method))
      assert.ok(operation.requestBody?.content?.['application/json']?.schema);
  }
  const root = readFileSync(
    new URL('../src/app.module.ts', import.meta.url),
    'utf8',
  );
  for (const name of [
    'AirlinesModule',
    'AirportsModule',
    'FlightsModule',
    'HotelsCatalogueModule',
  ])
    assert.ok(root.includes(name));
});

test('airport list is public, searchable, paginated and read-only; validation errors are consistent', async () => {
  const found = await request(http)
    .get('/api/airports')
    .query({ search: 'CAI' })
    .expect(200);
  assert.equal(found.body.items[0]._id, 'CAI');
  assert.equal(found.body.items[0].timeZone, 'Africa/Cairo');
  assert.equal(found.body.meta.pageSize, 10);
  await admin.post('/api/airports').send({ iataCode: 'BAD' }).expect(404);
  const bad = await request(http)
    .get('/api/airports')
    .query({ page: 0 })
    .expect(400);
  assert.equal(bad.body.code, 'VALIDATION_FAILED');
  assert.ok(bad.body.details.some((detail) => detail.field === 'page'));
});

test('public registration cannot create an administrator; profile management enforces assigned provider', async () => {
  await request(http)
    .post('/api/auth/register')
    .send({
      name: 'Forbidden Admin',
      email: 'forbidden@yassin-test.example',
      password,
      acceptTerms: true,
      role: 'admin',
    })
    .expect(400);
  await request(http)
    .post('/api/airlines')
    .send({ name: 'Other', code: 'OA', currency: 'EGP' })
    .expect(401);
  await outsider
    .post('/api/airlines')
    .send({ name: 'Other', code: 'OA', currency: 'EGP' })
    .expect(403);
  const created = await admin
    .post('/api/airlines')
    .send({ name: 'Other Airline', code: 'OA', currency: 'EGP' })
    .expect(201);
  await moderator
    .patch(`/api/airlines/${created.body._id}`)
    .send({ name: 'Hijacked' })
    .expect(403);
  await moderator
    .patch(`/api/airlines/${airline.id}`)
    .send({ name: 'Yassin Demo Air' })
    .expect(200);
  await request(http).get(`/api/airlines/${airline.id}`).expect(200);
  await moderator
    .patch(`/api/airlines/${airline.id}`)
    .send({ status: 'deactivated' })
    .expect(400);
  await moderator
    .patch(`/api/airlines/${airline.id}`)
    .send({ logoAssetId: 'pending-owned-upload' })
    .expect(404); // real GEN-08 resolver: unknown asset (was 501 with the pending stub)
});

test('baggage and cancellation policies enforce limits and unique thresholds', async () => {
  const path = `/api/airlines/${airline.id}`;
  await moderator
    .put(`${path}/baggage-policy`)
    .send({ extraBagPrice: 25, maxExtraBags: 2 })
    .expect(200);
  for (const dto of [
    { extraBagPrice: 0, maxExtraBags: 2 },
    { extraBagPrice: 25, maxExtraBags: -1 },
    { extraBagPrice: 25, maxExtraBags: 0.5 },
  ])
    await moderator.put(`${path}/baggage-policy`).send(dto).expect(400);
  await moderator
    .put(`${path}/cancellation-policy`)
    .send({
      tiers: [
        { daysBefore: 7, refundPercentage: 80 },
        { daysBefore: 0, refundPercentage: 20 },
      ],
    })
    .expect(200);
  for (const tiers of [
    [{ daysBefore: 0, refundPercentage: 101 }],
    [
      { daysBefore: 0, refundPercentage: 20 },
      { daysBefore: 0, refundPercentage: 40 },
    ],
  ])
    await moderator
      .put(`${path}/cancellation-policy`)
      .send({ tiers })
      .expect(400);
});

test('flight creation validates airports, UTC ordering, future dates, local-date duplicates and cabin classes', async () => {
  const dto = flightBody('YS100');
  await moderator
    .post('/api/flights')
    .send({ ...dto, arrivalAirport: 'CAI' })
    .expect(400);
  await moderator
    .post('/api/flights')
    .send({ ...dto, departureAirport: 'ZZZ' })
    .expect(400);
  await moderator
    .post('/api/flights')
    .send({ ...dto, arrivalLocal: `${date}T11:00` })
    .expect(400);
  await moderator
    .post('/api/flights')
    .send({
      ...dto,
      departureLocal: '2020-01-01T10:00',
      arrivalLocal: '2020-01-01T15:00',
    })
    .expect(400);
  const flight = await createFlight('YS100');
  await moderator
    .post('/api/flights')
    .send({
      ...dto,
      departureLocal: `${date}T11:00`,
      arrivalLocal: `${date}T16:00`,
    })
    .expect(409);
  await createCabin(flight._id);
  await moderator
    .post(`/api/flights/${flight._id}/cabins`)
    .send(cabinBody())
    .expect(409);
  await moderator
    .post(`/api/flights/${flight._id}/cabins`)
    .send({ ...cabinBody(), cabinClass: 'Luxury' })
    .expect(400);
  const details = await request(http)
    .get(`/api/flights/${flight._id}`)
    .expect(200);
  assert.equal(details.body.departureTime, '2099-12-01T08:00:00.000Z');
  assert.equal(details.body.departureLocal, `${date}T10:00:00`);
  assert.equal(details.body.origin.timeZone, 'Africa/Cairo');
  assert.equal(details.body.cabins[0].seatsRemaining, 5);
  assert.equal(details.body.policy.cancellationTiers[0].daysBefore, 7);
});

test('flight APIs enforce ownership and reject arbitrary counter updates', async () => {
  const foreign = await connection.model('Airline').findOne({ code: 'OA' });
  await moderator
    .post('/api/flights')
    .send({ ...flightBody('OA100'), airlineId: foreign.id })
    .expect(403);
  const flight = await createFlight('YS101');
  const cabin = await createCabin(flight._id);
  await outsider
    .patch(`/api/flights/${flight._id}`)
    .send({ arrivalLocal: `${date}T16:00` })
    .expect(403);
  await outsider
    .post(`/api/flights/${flight._id}/cancel`)
    .send({ confirmed: true })
    .expect(403);
  await moderator
    .patch(`/api/flights/${flight._id}/cabins/${cabin._id}`)
    .send({ heldSeats: 0 })
    .expect(400);
  await request(http).get('/api/flights/not-an-id').expect(400);
});

test('search subtracts booked and held seats, prices infants, preserves inclusive filters and paginates', async () => {
  for (let i = 0; i < 12; i++) {
    const flight = await createFlight(`YS2${i}`),
      cabin = await createCabin(flight._id, 4, 200 + i);
    await connection
      .model('CabinInventory')
      .updateOne(
        { _id: cabin._id },
        { $set: { bookedSeats: 1, heldSeats: 1 } },
      );
  }
  const query = search({
    adults: 1,
    children: 1,
    infants: 1,
    minPrice: 200,
    maxPrice: 211,
  });
  const first = await request(http)
    .get('/api/flights/search')
    .query(query)
    .expect(200);
  assert.equal(first.body.outbound.items.length, 10);
  assert.equal(first.body.outbound.meta.totalItems, 12);
  assert.equal(first.body.outbound.items[0].totalPrice, 420);
  assert.equal(first.body.outbound.items[0].seatsRemaining, 2);
  const second = await request(http)
    .get('/api/flights/search')
    .query({ ...query, page: 2 })
    .expect(200);
  assert.equal(second.body.outbound.items.length, 2);
  const empty = await request(http)
    .get('/api/flights/search')
    .query(search({ adults: 3, minPrice: 200, maxPrice: 211 }))
    .expect(200);
  assert.equal(empty.body.outbound.meta.totalItems, 0);
  assert.equal(empty.body.outbound.message, 'No flights found');
  const desc = await request(http)
    .get('/api/flights/search')
    .query({ ...query, sortOrder: 'desc' })
    .expect(200);
  assert.equal(desc.body.outbound.items[0].price, 211);
  for (const invalid of [
    { infants: 2 },
    { adults: 0 },
    { minPrice: 300, maxPrice: 200 },
    { departureDate: '2099-02-30' },
    { tripType: 'round-trip' },
    { returnDate: '2099-12-05' },
  ])
    await request(http)
      .get('/api/flights/search')
      .query(search(invalid))
      .expect(400);
});

test('round-trip returns reverse-route options; cabin, departure and duration sorting work', async () => {
  const inbound = await createFlight('YS310', {
    departureAirport: 'DXB',
    arrivalAirport: 'CAI',
    departureLocal: '2099-12-05T10:00',
    arrivalLocal: '2099-12-05T13:00',
  });
  await createCabin(inbound._id, 5, 330);
  const round = await request(http)
    .get('/api/flights/search')
    .query(search({ tripType: 'round-trip', returnDate: '2099-12-05' }))
    .expect(200);
  assert.equal(round.body.return.meta.totalItems, 1);
  assert.equal(round.body.return.items[0].flightId, inbound._id);
  const business = await request(http)
    .get('/api/flights/search')
    .query(search({ cabinClass: 'Business' }))
    .expect(200);
  assert.equal(business.body.outbound.meta.totalItems, 0);
  const short = await createFlight('YS311');
  await createCabin(short._id, 5, 350);
  const long = await createFlight('YS312', {
    departureLocal: `${date}T11:00`,
    arrivalLocal: `${date}T17:00`,
  });
  await createCabin(long._id, 5, 350);
  const duration = await request(http)
    .get('/api/flights/search')
    .query(search({ minPrice: 350, maxPrice: 350, sortBy: 'duration' }))
    .expect(200);
  assert.equal(duration.body.outbound.items[0].flightId, short._id);
  const departure = await request(http)
    .get('/api/flights/search')
    .query(
      search({
        minPrice: 350,
        maxPrice: 350,
        sortBy: 'departureTime',
        sortOrder: 'desc',
      }),
    )
    .expect(200);
  assert.equal(departure.body.outbound.items[0].flightId, long._id);
});

test('flight search uses the departure airport calendar date across UTC midnight', async () => {
  const flight = await createFlight('YS320', {
    departureAirport: 'HND',
    arrivalAirport: 'LHR',
    departureLocal: '2099-12-02T00:30',
    arrivalLocal: '2099-12-02T04:00',
  });
  await createCabin(flight._id);
  assert.equal(flight.departureTime, '2099-12-01T15:30:00.000Z');
  const query = {
    departureAirport: 'HND',
    arrivalAirport: 'LHR',
    departureDate: '2099-12-02',
  };
  assert.equal(
    (await request(http).get('/api/flights/search').query(query).expect(200))
      .body.outbound.items[0].flightId,
    flight._id,
  );
  assert.equal(
    (
      await request(http)
        .get('/api/flights/search')
        .query({ ...query, departureDate: date })
        .expect(200)
    ).body.outbound.meta.totalItems,
    0,
  );
});

test('capacity floor and lifetime booking history are enforced; update and cancellation events are durable', async () => {
  const flight = await createFlight('YS400'),
    id = flight._id,
    cabin = await createCabin(id);
  await connection
    .model('CabinInventory')
    .updateOne({ _id: cabin._id }, { $set: { bookedSeats: 2, heldSeats: 2 } });
  await moderator
    .patch(`/api/flights/${id}/cabins/${cabin._id}`)
    .send({ seatCount: 3 })
    .expect(409);
  await moderator
    .patch(`/api/flights/${id}/cabins/${cabin._id}`)
    .send({ seatCount: 4, price: 150 })
    .expect(200);
  await connection
    .model('Flight')
    .updateOne({ _id: id }, { $set: { bookingCount: 1 } });
  await moderator
    .patch(`/api/flights/${id}`)
    .send({ arrivalAirport: 'RUH', arrivalLocal: `${date}T16:00` })
    .expect(409);
  await moderator
    .patch(`/api/flights/${id}`)
    .send({ arrivalLocal: `${date}T16:00` })
    .expect(200);
  const updated = await connection
    .model('FlightEvent')
    .findOne({ flightId: id, topic: 'flight.updated' });
  assert.ok(updated);
  assert.equal(updated.deliveredAt, null);
  const events = app.get(FlightEventsService),
    received = [];
  const handler = async (event) => {
    received.push(event);
  };
  events.on('flight.updated', handler);
  events.on('flight.cancelled', handler);
  await events.dispatchPending();
  assert.ok(received.some((event) => event.eventId === updated.id));
  await moderator
    .post(`/api/flights/${id}/cancel`)
    .send({ confirmed: false })
    .expect(400);
  await moderator
    .post(`/api/flights/${id}/cancel`)
    .send({ confirmed: true })
    .expect(200);
  await moderator
    .post(`/api/flights/${id}/cancel`)
    .send({ confirmed: true })
    .expect(200);
  assert.equal(
    await connection
      .model('FlightEvent')
      .countDocuments({ flightId: id, topic: 'flight.cancelled' }),
    1,
  );
  assert.ok(
    received.some(
      (event) => event.flightId === id && event.airlineId === airline.id,
    ),
  );
  await moderator
    .patch(`/api/flights/${id}`)
    .send({ arrivalLocal: `${date}T17:00` })
    .expect(409);
  await moderator
    .post(`/api/flights/${id}/cabins`)
    .send({ ...cabinBody(), cabinClass: 'Business' })
    .expect(409);
  events.off('flight.updated', handler);
  events.off('flight.cancelled', handler);
});

test('failed event consumers retain the committed cancellation for idempotent retry', async () => {
  const flight = await createFlight('YS401'),
    events = app.get(FlightEventsService);
  const failing = async () => {
    throw new Error('Deliberate isolated test failure');
  };
  events.on('flight.cancelled', failing);
  await moderator
    .post(`/api/flights/${flight._id}/cancel`)
    .send({ confirmed: true })
    .expect(200);
  const pending = await connection
    .model('FlightEvent')
    .findOne({ flightId: flight._id });
  assert.equal(pending.deliveredAt, null);
  assert.equal(
    (await connection.model('Flight').findById(flight._id)).status,
    'Cancelled',
  );
  events.off('flight.cancelled', failing);
  const retried = [];
  const succeeding = async (event) => {
    retried.push(event.eventId);
  };
  events.on('flight.cancelled', succeeding);
  await connection
    .model('FlightEvent')
    .updateOne({ _id: pending._id }, { $set: { leaseUntil: null } });
  await events.dispatchPending();
  assert.ok(retried.includes(pending.id));
  assert.ok(
    (await connection.model('FlightEvent').findById(pending._id)).deliveredAt,
  );
  events.off('flight.cancelled', succeeding);
});

test('outbox persistence failure rolls the flight cancellation back', async () => {
  const flight = await createFlight('YS402');
  const outbox = connection.model('FlightEvent');
  const create = outbox.create;
  outbox.create = async () => {
    throw new Error('Isolated outbox fault injection');
  };
  try {
    await moderator
      .post(`/api/flights/${flight._id}/cancel`)
      .send({ confirmed: true })
      .expect(500);
  } finally {
    outbox.create = create;
  }
  assert.equal(
    (await connection.model('Flight').findById(flight._id)).status,
    'Scheduled',
  );
  assert.equal(await outbox.countDocuments({ flightId: flight._id }), 0);
});

test('a simultaneous hold-counter increment and capacity reduction never violate capacity', async () => {
  for (let i = 0; i < 3; i++) {
    const flight = await createFlight(`YS42${i}`),
      cabin = await createCabin(flight._id, 2);
    const [edit, hold] = await Promise.all([
      moderator
        .patch(`/api/flights/${flight._id}/cabins/${cabin._id}`)
        .send({ seatCount: 1 }),
      connection.model('CabinInventory').updateOne(
        {
          _id: cabin._id,
          $expr: {
            $gte: [
              {
                $subtract: [
                  '$seatCount',
                  { $add: ['$bookedSeats', '$heldSeats'] },
                ],
              },
              2,
            ],
          },
        },
        { $inc: { heldSeats: 2 } },
      ),
    ]);
    const stored = await connection.model('CabinInventory').findById(cabin._id);
    assert.ok(stored.bookedSeats + stored.heldSeats <= stored.seatCount);
    assert.ok(!(edit.status === 200 && hold.modifiedCount === 1));
  }
});

test('departed/cancelled flights and deactivated airlines leave search; existing catalogue records remain', async () => {
  const flight = await createFlight('YS500');
  await createCabin(flight._id, 5, 500);
  await connection.model('Flight').updateOne(
    { _id: flight._id },
    {
      $set: {
        departureTime: new Date('2020-01-01T08:00Z'),
        arrivalTime: new Date('2020-01-01T11:00Z'),
      },
    },
  );
  await moderator
    .patch(`/api/flights/${flight._id}`)
    .send({ arrivalLocal: `${date}T16:00` })
    .expect(409);
  assert.equal(
    (await connection.model('Flight').findById(flight._id)).status,
    'Departed',
  );
  const cancelled = await request(http)
    .get('/api/flights/search')
    .query(search({ minPrice: 150, maxPrice: 150 }))
    .expect(200);
  assert.equal(cancelled.body.outbound.meta.totalItems, 0);
  await connection
    .model('Airline')
    .updateOne({ _id: airline._id }, { $set: { status: 'deactivated' } });
  const inactive = await request(http)
    .get('/api/flights/search')
    .query(search({}))
    .expect(200);
  assert.equal(inactive.body.outbound.meta.totalItems, 0);
  await moderator.post('/api/flights').send(flightBody('YS501')).expect(409);
  assert.ok(await connection.model('Flight').exists({ _id: flight._id }));
  await connection
    .model('Airline')
    .updateOne({ _id: airline._id }, { $set: { status: 'active' } });
});

test('hotel search enforces entire stays, combined room capacity, cheapest qualifying price and rating', async () => {
  const hotel = await connection.model('Hotel').create({
    name: 'Search Hotel',
    address: 'Test',
    cityId: 'cairo',
    countryCode: 'EG',
    starClass: 4,
    currency: 'EGP',
    averageRating: 4.5,
    ratingCount: 2,
  });
  const startDate = new Date(`${date}T00:00:00Z`),
    endDate = new Date('2099-12-10T00:00:00Z');
  const single = await connection.model('Room').create({
    hotelId: hotel._id,
    roomNumber: 'S1',
    type: 'Single',
    beds: 1,
    maxOccupancy: 1,
    pricePerNight: 20,
  });
  const double = await connection.model('Room').create({
    hotelId: hotel._id,
    roomNumber: 'D1',
    type: 'Double',
    beds: 2,
    maxOccupancy: 2,
    pricePerNight: 100,
  });
  for (const room of [single, double])
    await connection
      .model('RoomAvailability')
      .create({ roomId: room._id, startDate, endDate, kind: 'Available' });
  const query = {
    cityId: 'cairo',
    checkInDate: date,
    checkOutDate: '2099-12-03',
    guests: 2,
  };
  const found = await request(http)
    .get('/api/hotels/search')
    .query(query)
    .expect(200);
  assert.equal(found.body.items[0].pricePerNight, 100);
  assert.equal(found.body.items[0].cheapestQualifyingRoomStayPrice, 200);
  const multiple = await request(http)
    .get('/api/hotels/search')
    .query({ ...query, rooms: 2, guests: 3 })
    .expect(200);
  assert.equal(multiple.body.items[0].pricePerNight, 20);
  for (const change of [
    { maxPrice: 99 },
    { minRating: 4.6 },
    { rooms: 2, guests: 4 },
  ]) {
    const empty = await request(http)
      .get('/api/hotels/search')
      .query({ ...query, ...change })
      .expect(200);
    assert.equal(empty.body.items.length, 0);
  }
  const hold = await connection.model('RoomAvailability').create({
    roomId: double._id,
    startDate,
    endDate,
    kind: 'Pending Payment',
    holdExpiresAt: new Date(Date.now() + 600_000),
  });
  assert.equal(
    (await request(http).get('/api/hotels/search').query(query).expect(200))
      .body.items.length,
    0,
  );
  await connection
    .model('RoomAvailability')
    .updateOne(
      { _id: hold._id },
      { $set: { holdExpiresAt: new Date(Date.now() - 1) } },
    );
  assert.equal(
    (await request(http).get('/api/hotels/search').query(query).expect(200))
      .body.items.length,
    1,
  );
  await connection
    .model('RoomAvailability')
    .create({ roomId: double._id, startDate, endDate, kind: 'Confirmed' });
  assert.equal(
    (await request(http).get('/api/hotels/search').query(query).expect(200))
      .body.items.length,
    0,
  );
  await connection
    .model('RoomAvailability')
    .create({ roomId: single._id, startDate, endDate, kind: 'Blocked' });
  assert.equal(
    (
      await request(http)
        .get('/api/hotels/search')
        .query({ ...query, guests: 1 })
        .expect(200)
    ).body.items.length,
    0,
  );
  await connection
    .model('Hotel')
    .updateOne({ _id: hotel._id }, { $set: { status: 'deactivated' } });
});

test('hotel sorting/pagination, unrated exclusion, room status and date validation work', async () => {
  const query = {
    countryCode: 'EG',
    checkInDate: date,
    checkOutDate: '2099-12-03',
    guests: 2,
  };
  for (let i = 0; i < 12; i++) {
    const hotel = await connection.model('Hotel').create({
      name: `Page Hotel ${i}`,
      address: 'Test',
      cityId: 'cairo',
      countryCode: 'EG',
      starClass: 3,
      currency: 'EGP',
      averageRating: i === 0 ? null : 3 + i / 10,
    });
    const room = await connection.model('Room').create({
      hotelId: hotel._id,
      roomNumber: '101',
      type: 'Double',
      beds: 2,
      maxOccupancy: 2,
      pricePerNight: 100 + i,
    });
    await connection.model('RoomAvailability').create({
      roomId: room._id,
      startDate: new Date(`${date}T00:00Z`),
      endDate: new Date('2099-12-10T00:00Z'),
      kind: 'Available',
    });
    if (i === 11)
      await connection
        .model('Room')
        .updateOne({ _id: room._id }, { $set: { status: 'deactivated' } });
  }
  const first = await request(http)
    .get('/api/hotels/search')
    .query(query)
    .expect(200);
  assert.equal(first.body.items.length, 10);
  assert.equal(first.body.meta.totalItems, 11);
  const second = await request(http)
    .get('/api/hotels/search')
    .query({ ...query, page: 2 })
    .expect(200);
  assert.equal(second.body.items.length, 1);
  const rated = await request(http)
    .get('/api/hotels/search')
    .query({ ...query, minRating: 1, sortBy: 'rating', sortOrder: 'desc' })
    .expect(200);
  assert.equal(rated.body.meta.totalItems, 10);
  assert.equal(rated.body.items[0].averageRating, 4);
  for (const invalid of [
    { checkOutDate: date },
    { checkInDate: '2020-01-01' },
    { minPrice: 100, maxPrice: 20 },
    { cityId: 'london' },
    { rooms: 0 },
  ])
    await request(http)
      .get('/api/hotels/search')
      .query({ ...query, ...invalid })
      .expect(400);
});

test('deactivated hotels disappear even when rooms are free; provider deactivation preserves inventory', async () => {
  const hotel = await connection.model('Hotel').create({
    name: 'Status Hotel',
    address: 'Test',
    cityId: 'dubai',
    countryCode: 'AE',
    starClass: 4,
    currency: 'EGP',
  });
  const room = await connection.model('Room').create({
    hotelId: hotel._id,
    roomNumber: '101',
    type: 'Double',
    beds: 2,
    maxOccupancy: 2,
    pricePerNight: 100,
  });
  await connection.model('RoomAvailability').create({
    roomId: room._id,
    startDate: new Date(`${date}T00:00Z`),
    endDate: new Date('2099-12-10T00:00Z'),
    kind: 'Available',
  });
  const query = {
    cityId: 'dubai',
    checkInDate: date,
    checkOutDate: '2099-12-03',
    guests: 2,
    minPrice: 100,
    maxPrice: 100,
  };
  assert.equal(
    (await request(http).get('/api/hotels/search').query(query).expect(200))
      .body.items.length,
    1,
  );
  await connection
    .model('Hotel')
    .updateOne({ _id: hotel._id }, { $set: { status: 'deactivated' } });
  assert.equal(
    (await request(http).get('/api/hotels/search').query(query).expect(200))
      .body.items.length,
    0,
  );
  assert.ok(await connection.model('Room').exists({ _id: room._id }));
});

test('regression: valid fractional prices are not silently rounded to zero', async () => {
  const flight = await createFlight('YS600');
  await createCabin(flight._id, 5, 0.001);
  const quoted = await request(http)
    .get('/api/flights/search')
    .query(search({ minPrice: 0.001, maxPrice: 0.001 }))
    .expect(200);
  assert.equal(quoted.body.outbound.items[0].totalPrice, 0.001);
  const hotel = await connection.model('Hotel').create({
    name: 'Fractional Hotel',
    address: 'Test',
    cityId: 'london',
    countryCode: 'GB',
    starClass: 3,
    currency: 'EGP',
  });
  const room = await connection.model('Room').create({
    hotelId: hotel._id,
    roomNumber: '101',
    type: 'Single',
    beds: 1,
    maxOccupancy: 1,
    pricePerNight: 0.001,
  });
  await connection.model('RoomAvailability').create({
    roomId: room._id,
    startDate: new Date(`${date}T00:00Z`),
    endDate: new Date('2099-12-10T00:00Z'),
    kind: 'Available',
  });
  const stay = await request(http)
    .get('/api/hotels/search')
    .query({
      cityId: 'london',
      checkInDate: date,
      checkOutDate: '2099-12-03',
      guests: 1,
      minPrice: 0.001,
      maxPrice: 0.001,
    })
    .expect(200);
  assert.equal(stay.body.items[0].cheapestQualifyingRoomStayPrice, 0.002);
});

test('regression: a dispatch outage after commit does not turn cancellation into an API failure', async () => {
  const flight = await createFlight('YS601');
  const events = app.get(FlightEventsService),
    original = events.dispatchPending;
  events.dispatchPending = async () => {
    throw new Error('Isolated dispatch outage');
  };
  try {
    await moderator
      .post(`/api/flights/${flight._id}/cancel`)
      .send({ confirmed: true })
      .expect(200);
  } finally {
    events.dispatchPending = original;
  }
  assert.equal(
    (await connection.model('Flight').findById(flight._id)).status,
    'Cancelled',
  );
  assert.equal(
    (await connection.model('FlightEvent').findOne({ flightId: flight._id }))
      .deliveredAt,
    null,
  );
});

test('regression: flights predating inventoryRevision can still receive schedule edits', async () => {
  const flight = await createFlight('YS602');
  await connection
    .model('Flight')
    .collection.updateOne(
      { _id: new connection.base.Types.ObjectId(flight._id) },
      { $unset: { inventoryRevision: '' } },
    );
  await moderator
    .patch(`/api/flights/${flight._id}`)
    .send({ arrivalLocal: `${date}T16:00` })
    .expect(200);
  assert.equal(
    (await connection.model('Flight').findById(flight._id)).inventoryRevision,
    1,
  );
});

test('regression: unrepresentable pagination is rejected with validation instead of a server error', async () => {
  const invalid = await request(http)
    .get('/api/airports')
    .query({ page: '1e308' })
    .expect(400);
  assert.equal(invalid.body.code, 'VALIDATION_FAILED');
});

test('exported searches apply defaults and validation for internal itinerary callers', async () => {
  const flight = await createFlight('YS603');
  await createCabin(flight._id, 5, 0.005);
  const flights = app.get(FlightsService);
  const result = await flights.search(
    search({ minPrice: 0.005, maxPrice: 0.005 }),
  );
  assert.equal(result.passengers.adults, 1);
  assert.equal(result.passengers.seatsRequired, 1);
  assert.equal(result.outbound.items[0].flightId, flight._id);
  await assert.rejects(
    flights.search(search({ children: 0.5 })),
    (error) => error.getStatus() === 400,
  );
  await assert.rejects(
    app.get(HotelsSearchService).search({
      cityId: 'cairo',
      checkInDate: date,
      checkOutDate: '2099-12-03',
      guests: 0,
    }),
    (error) => error.getStatus() === 400,
  );
});

test('logo integration: missing adapter returns 501 atomically; resolver receives actor and target', async () => {
  const service = app.get(AirlinesService),
    original = service.logos;
  const before = await connection.model('Airline').findById(airline.id).lean();
  await moderator
    .patch(`/api/airlines/${airline.id}`)
    .send({ name: 'Must not partially save', logoAssetId: 'test-asset' })
    .expect(404); // real GEN-08 resolver: unknown asset (was 501 with the pending stub)
  assert.equal(
    (await connection.model('Airline').findById(airline.id)).name,
    before.name,
  );
  const calls = [];
  service.logos = {
    async resolve(...args) {
      calls.push(args);
      return '/uploads/verified-test.png';
    },
  };
  try {
    await outsider
      .patch(`/api/airlines/${airline.id}`)
      .send({ logoAssetId: 'test-asset' })
      .expect(403);
    assert.equal(calls.length, 0);
    const saved = await moderator
      .patch(`/api/airlines/${airline.id}`)
      .send({ logoAssetId: 'test-asset' })
      .expect(200);
    assert.equal(saved.body.logoUrl, '/uploads/verified-test.png');
    const actor = await connection
      .model('User')
      .findOne({ email: options.demo.airlineModerator.email });
    assert.deepEqual(calls, [['test-asset', actor.id, airline.id]]);
  } finally {
    service.logos = original;
    await connection
      .model('Airline')
      .updateOne({ _id: airline.id }, { $set: { logoUrl: before.logoUrl } });
  }
});

test('legacy airport edits require authoritative all-state booking history, not hydrated defaults', async () => {
  const service = app.get(FlightsService),
    original = service.historyReader;
  const legacy = await createFlight('YS700');
  await connection
    .model('Flight')
    .collection.updateOne(
      { _id: new connection.base.Types.ObjectId(legacy._id) },
      { $unset: { bookingCount: '' } },
    );
  const change = { arrivalAirport: 'RUH', arrivalLocal: `${date}T15:00` };
  const unknown = await moderator
    .patch(`/api/flights/${legacy._id}`)
    .send(change)
    .expect(501);
  assert.equal(unknown.body.code, 'NOT_IMPLEMENTED');
  assert.equal(
    (await connection.model('Flight').findById(legacy._id)).arrivalAirport,
    'DXB',
  );
  const calls = [];
  try {
    service.historyReader = {
      async hasAnyBooking(id, session) {
        calls.push(id);
        assert.ok(session.inTransaction());
        return true;
      },
    };
    await moderator
      .patch(`/api/flights/${legacy._id}`)
      .send(change)
      .expect(409);
    service.historyReader = {
      async hasAnyBooking(id, session) {
        calls.push(id);
        assert.ok(session.inTransaction());
        return false;
      },
    };
    await moderator
      .patch(`/api/flights/${legacy._id}`)
      .send(change)
      .expect(200);
    const stored = await connection.model('Flight').collection.findOne({
      _id: new connection.base.Types.ObjectId(legacy._id),
    });
    assert.equal(stored.bookingCount, 0);
    assert.equal(stored.arrivalAirport, 'RUH');
    assert.deepEqual(calls, [legacy._id, legacy._id]);
    // A normal new record needs no legacy adapter.
    service.historyReader = original;
    const current = await createFlight('YS701');
    await moderator
      .patch(`/api/flights/${current._id}`)
      .send(change)
      .expect(200);
  } finally {
    service.historyReader = original;
  }
});

test('event delivery preserves once removal and the EventEmitter callback receiver', async () => {
  const events = app.get(FlightEventsService),
    outbox = connection.model('FlightEvent');
  // Drain only isolated fixture events so the once listener observes the intended flight.
  const drain = async () => {};
  events.on('flight.cancelled', drain);
  await outbox.updateMany(
    { deliveredAt: null },
    { $set: { leaseUntil: null } },
  );
  await events.dispatchPending();
  events.off('flight.cancelled', drain);
  const first = await createFlight('YS702'),
    second = await createFlight('YS703');
  const received = [];
  function once(payload) {
    assert.equal(this, events);
    received.push(payload.flightId);
  }
  events.once('flight.cancelled', once);
  try {
    await moderator
      .post(`/api/flights/${first._id}/cancel`)
      .send({ confirmed: true })
      .expect(200);
    assert.equal(events.listenerCount('flight.cancelled'), 0);
    await moderator
      .post(`/api/flights/${second._id}/cancel`)
      .send({ confirmed: true })
      .expect(200);
    assert.deepEqual(received, [first._id]);
    assert.equal(
      (await outbox.findOne({ flightId: second._id })).deliveredAt,
      null,
    );
  } finally {
    events.off('flight.cancelled', once);
  }
});

test('acknowledgement loss replays the same event ID; a mock receipt deduplicates its side effect', async () => {
  const events = app.get(FlightEventsService),
    outbox = connection.model('FlightEvent');
  const flight = await createFlight('YS704');
  const seen = [],
    receipts = new Set();
  let effects = 0,
    failAck = true;
  const handler = async (event) => {
    if (event.flightId !== flight._id) return;
    seen.push(event.eventId);
    if (!receipts.has(event.eventId)) {
      receipts.add(event.eventId);
      effects++;
    }
  };
  const update = outbox.updateOne;
  outbox.updateOne = function (filter, changes, ...args) {
    if (
      failAck &&
      changes.$set?.deliveredAt &&
      receipts.has(String(filter._id))
    ) {
      failAck = false;
      throw new Error('Isolated acknowledgement loss');
    }
    return update.call(this, filter, changes, ...args);
  };
  events.on('flight.cancelled', handler);
  try {
    await moderator
      .post(`/api/flights/${flight._id}/cancel`)
      .send({ confirmed: true })
      .expect(200);
    const pending = await outbox.findOne({ flightId: flight._id });
    assert.equal(pending.deliveredAt, null);
    await update.call(
      outbox,
      { _id: pending._id },
      { $set: { leaseUntil: null } },
    );
    await events.dispatchPending();
    assert.deepEqual(seen, [pending.id, pending.id]);
    assert.equal(effects, 1);
    assert.ok((await outbox.findById(pending._id)).deliveredAt);
  } finally {
    outbox.updateOne = update;
    events.off('flight.cancelled', handler);
  }
});

test('PAY-04: default search excludes legacy foreign prices and rejects foreign currency filters', async () => {
  const departureDate = '2099-12-20';
  for (const [currency, price] of [
    ['EGP', 702],
    ['USD', 701],
  ]) {
    const provider = await connection.model('Airline').create({
      name: `Currency ${currency}`,
      code: currency === 'EGP' ? 'QE' : 'QU',
      currency: 'EGP',
    });
    const flight = await connection.model('Flight').create({
      airlineId: provider._id,
      flightNumber: `FX${currency}`,
      departureAirport: 'CAI',
      arrivalAirport: 'DXB',
      departureDate,
      departureTime: new Date(`${departureDate}T08:00Z`),
      arrivalTime: new Date(`${departureDate}T11:00Z`),
    });
    await connection
      .model('CabinInventory')
      .create({ flightId: flight._id, ...cabinBody(5, price) });
    const hotel = await connection.model('Hotel').create({
      name: `Currency ${currency}`,
      address: 'Fixture',
      cityId: 'frankfurt',
      countryCode: 'DE',
      starClass: 4,
      currency: 'EGP',
    });
    if (currency !== 'EGP') {
      await connection
        .model('Airline')
        .collection.updateOne({ _id: provider._id }, { $set: { currency } });
      await connection
        .model('Hotel')
        .collection.updateOne({ _id: hotel._id }, { $set: { currency } });
    }
    const room = await connection.model('Room').create({
      hotelId: hotel._id,
      roomNumber: '1',
      type: 'Single',
      beds: 1,
      maxOccupancy: 1,
      pricePerNight: price,
    });
    await connection.model('RoomAvailability').create({
      roomId: room._id,
      startDate: new Date(`${departureDate}T00:00Z`),
      endDate: new Date('2099-12-23T00:00Z'),
      kind: 'Available',
    });
  }
  const flightQuery = search({ departureDate, minPrice: 701, maxPrice: 702 });
  const hotelQuery = {
    cityId: 'frankfurt',
    checkInDate: departureDate,
    checkOutDate: '2099-12-22',
    guests: 1,
    minPrice: 701,
    maxPrice: 702,
  };
  for (const [path, query, items] of [
    ['/api/flights/search', flightQuery, (body) => body.outbound.items],
    ['/api/hotels/search', hotelQuery, (body) => body.items],
  ]) {
    const mixed = await request(http).get(path).query(query).expect(200);
    assert.deepEqual(
      items(mixed.body).map((item) => item.currency),
      ['EGP'],
    );
    const exact = await request(http)
      .get(path)
      .query({ ...query, currency: 'EGP' })
      .expect(200);
    assert.deepEqual(
      items(exact.body).map((item) => item.currency),
      ['EGP'],
    );
    const inclusive = await request(http)
      .get(path)
      .query({ ...query, maxPrice: 701 })
      .expect(200);
    assert.deepEqual(items(inclusive.body), []);
    await request(http)
      .get(path)
      .query({ ...query, currency: 'USD' })
      .expect(400);
    await request(http)
      .get(path)
      .query({ ...query, currency: 'EUR' })
      .expect(400);
  }
  const legacy = await connection
    .model('Airline')
    .findOne({ code: 'QU' })
    .lean();
  assert.equal(legacy.currency, 'USD');
  assert.equal(
    (await connection.model('CabinInventory').findOne({ price: 701 })).price,
    701,
  );
});

test('PAY-04: airline creation rejects foreign currency through HTTP and internal service calls', async () => {
  const before = await connection.model('Airline').countDocuments();
  for (const currency of ['USD', 'EUR', 'GBP', 'AED', 'JPY', 'SAR']) {
    await admin
      .post('/api/airlines')
      .send({ name: 'Rejected foreign provider', code: 'QM', currency })
      .expect(400);
    await assert.rejects(
      async () =>
        app
          .get(AirlinesService)
          .create({ name: 'Rejected internal provider', code: 'QM', currency }),
      (error) => error.getStatus() === 400,
    );
  }
  assert.equal(await connection.model('Airline').countDocuments(), before);
});

test('PAY-04: legacy foreign airlines cannot receive new flight/cabin prices or publish flight price details', async () => {
  const flight = await createFlight('YS800');
  const cabin = await createCabin(flight._id);
  await connection
    .model('Airline')
    .collection.updateOne({ _id: airline._id }, { $set: { currency: 'USD' } });
  try {
    await moderator.post('/api/flights').send(flightBody('YS801')).expect(400);
    await request(http).get(`/api/flights/${flight._id}`).expect(400);
    await moderator
      .post(`/api/flights/${flight._id}/cabins`)
      .send({ ...cabinBody(), cabinClass: 'Business' })
      .expect(400);
    await moderator
      .patch(`/api/flights/${flight._id}/cabins/${cabin._id}`)
      .send({ price: 123 })
      .expect(400);
    await moderator
      .put(`/api/airlines/${airline.id}/baggage-policy`)
      .send({ extraBagPrice: 123, maxExtraBags: 1 })
      .expect(400);
    assert.equal(
      (await connection.model('CabinInventory').findById(cabin._id)).price,
      100,
    );
    assert.equal(
      (await connection.model('Airline').findById(airline._id)).currency,
      'USD',
    );
  } finally {
    await connection
      .model('Airline')
      .collection.updateOne(
        { _id: airline._id },
        { $set: { currency: 'EGP' } },
      );
  }
});

test('hotel date characterization: today currently means UTC, including local-date boundaries', async (t) => {
  const service = app.get(HotelsSearchService);
  const query = {
    checkInDate: '2099-12-01',
    checkOutDate: '2099-12-03',
    guests: 1,
  };
  // Invoke the real service with only Date mocked; Mongo timers and network remain real.
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2099, 11, 1, 23, 30) });
  try {
    // Dubai is already Dec 2, but the current UTC rule permits Dec 1.
    await service.search({ ...query, cityId: 'dubai' });
    t.mock.timers.setTime(Date.UTC(2099, 11, 2, 0, 30));
    // New York is still Dec 1, but the current UTC rule rejects Dec 1.
    await assert.rejects(
      service.search({ ...query, cityId: 'new_york' }),
      (error) => error.getStatus() === 400,
    );
  } finally {
    t.mock.timers.reset();
  }
});

test('local synthetic dataset preserves global ordering and ten-item late pages', async (t) => {
  const departureDate = '2099-12-23';
  const flights = await connection.model('Flight').insertMany(
    Array.from({ length: 500 }, (_, i) => ({
      airlineId: airline._id,
      flightNumber: `PERF${i}`,
      departureAirport: 'CAI',
      arrivalAirport: 'DXB',
      departureDate,
      departureTime: new Date(`${departureDate}T08:00Z`),
      arrivalTime: new Date(`${departureDate}T11:00Z`),
    })),
  );
  await connection.model('CabinInventory').insertMany(
    flights.map((flight, i) => ({
      flightId: flight._id,
      ...cabinBody(5, i + 1),
    })),
  );
  const hotels = await connection.model('Hotel').insertMany(
    Array.from({ length: 100 }, (_, i) => ({
      name: `Perf ${i}`,
      address: 'Fixture',
      cityId: 'paris',
      countryCode: 'FR',
      starClass: 4,
      currency: 'EGP',
    })),
  );
  const rooms = await connection.model('Room').insertMany(
    hotels.flatMap((hotel, i) =>
      Array.from({ length: 10 }, (_, j) => ({
        hotelId: hotel._id,
        roomNumber: String(j),
        type: 'Single',
        beds: 1,
        maxOccupancy: 1,
        pricePerNight: i + j + 1,
      })),
    ),
  );
  await connection.model('RoomAvailability').insertMany(
    rooms.map((room) => ({
      roomId: room._id,
      startDate: new Date(`${departureDate}T00:00Z`),
      endDate: new Date('2099-12-26T00:00Z'),
      kind: 'Available',
    })),
  );
  const start = performance.now();
  const flightPage = await request(http)
    .get('/api/flights/search')
    .query(search({ departureDate, page: 50 }))
    .expect(200);
  const flightMs = performance.now() - start;
  assert.equal(flightPage.body.outbound.meta.totalItems, 500);
  assert.deepEqual(
    flightPage.body.outbound.items.map((item) => item.price),
    Array.from({ length: 10 }, (_, i) => 491 + i),
  );
  const hotelStart = performance.now();
  const hotelPage = await request(http)
    .get('/api/hotels/search')
    .query({
      cityId: 'paris',
      checkInDate: departureDate,
      checkOutDate: '2099-12-25',
      guests: 1,
      page: 10,
    })
    .expect(200);
  const hotelMs = performance.now() - hotelStart;
  assert.equal(hotelPage.body.meta.totalItems, 100);
  assert.deepEqual(
    hotelPage.body.items.map((item) => item.pricePerNight),
    Array.from({ length: 10 }, (_, i) => 91 + i),
  );
  t.diagnostic(
    `Local single-request timing only: 500 flight/cabin options ${flightMs.toFixed(1)}ms; 100 hotels/1000 rooms/1000 ranges ${hotelMs.toFixed(1)}ms. No evaluation SLA inferred.`,
  );
});

test('the actual AppModule boots with isolated configuration and exposes the documented feature routes', async () => {
  // Replace only configuration source selection so importing AppModule never opens .env.
  process.env.MONGODB_URI = mongo.getUri('yassin_actual_app_tests');
  process.env.JWT_SECRET = randomBytes(48).toString('hex');
  process.env.COOKIE_SECURE = 'false';
  for (const name of ['PORT', 'COOKIE_SAMESITE', 'FRONTEND_URL'])
    delete process.env[name];
  const configure = ConfigModule.forRoot;
  ConfigModule.forRoot = function (options) {
    return configure.call(this, { ...options, ignoreEnvFile: true });
  };
  let RootModule;
  try {
    RootModule = (await import('../dist/app.module.js')).AppModule;
  } finally {
    ConfigModule.forRoot = configure;
  }
  const actual = await NestFactory.create(RootModule, { logger: false });
  try {
    actual.setGlobalPrefix('api');
    actual.use(cookieParser());
    actual.useGlobalPipes(createValidationPipe());
    actual.useGlobalFilters(new AllExceptionsFilter());
    const document = SwaggerModule.createDocument(
      actual,
      new DocumentBuilder()
        .setTitle('Actual application')
        .setVersion('1')
        .build(),
    );
    SwaggerModule.setup('api/docs', actual, document);
    await actual.init();
    await request(actual.getHttpServer()).get('/api/health').expect(200);
    const airports = await request(actual.getHttpServer())
      .get('/api/airports')
      .expect(200);
    assert.equal(airports.body.meta.pageSize, 10);
    const spec = await request(actual.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    for (const path of [
      '/api/airlines',
      '/api/airports',
      '/api/flights/search',
      '/api/flights/{id}/cancel',
      '/api/hotels/search',
    ])
      assert.ok(spec.body.paths[path]);
  } finally {
    await actual.close();
  }
});

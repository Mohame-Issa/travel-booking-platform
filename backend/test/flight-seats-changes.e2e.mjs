// Youssef Khafagy: FLT-28 (seat selection) and FLT-27 (change a flight) end to
// end, on the REAL flight booking, payment, refund and notification modules,
// against a disposable local replica set. Never loads .env or touches the
// shared database. Stripe API calls go to an in-memory fake; webhooks are
// signed and verified with the real Stripe SDK.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import Stripe from 'stripe';
import request from 'supertest';
import { AllExceptionsFilter } from '../dist/common/filters/all-exceptions.filter.js';
import { RolesGuard } from '../dist/common/guards/roles.guard.js';
import {
  HOTEL_BOOKING_LIFECYCLE,
  HOTEL_BOOKING_PAYMENT_READER,
} from '../dist/common/interfaces/index.js';
import { createValidationPipe } from '../dist/common/pipes/validation.pipe.js';
import { FlightBookingsModule } from '../dist/flight-bookings/flight-bookings.module.js';
import { FlightBookingsService } from '../dist/flight-bookings/flight-bookings.service.js';
import { FlightChangesService } from '../dist/flight-bookings/flight-changes.service.js';
import { NotificationsModule } from '../dist/notifications/notifications.module.js';
import { STRIPE_CLIENT } from '../dist/payments/payments.constants.js';
import { PaymentsModule } from '../dist/payments/payments.module.js';
import { RefundsModule } from '../dist/refunds/refunds.module.js';
import { UploadsModule } from '../dist/uploads/uploads.module.js';
import { UsersModule } from '../dist/users/users.module.js';

const WEBHOOK_SECRET = 'whsec_e2e_test_only';
const DAY = 86_400_000;
const newUser = () => String(new Types.ObjectId());

// ---------------------------------------------------------------- fake Stripe
const signer = new Stripe('sk_test_e2e_dummy_never_used_for_network');
const stripeCalls = { intents: [], refunds: [] };
const intents = new Map();
const byKey = new Map();
let seq = 0;
const fakeStripe = {
  webhooks: signer.webhooks,
  paymentIntents: {
    async create(params, opts) {
      if (opts?.idempotencyKey && byKey.has(opts.idempotencyKey))
        return byKey.get(opts.idempotencyKey);
      const id = `pi_fc_${++seq}`;
      const pi = {
        id,
        client_secret: `${id}_secret_x`,
        status: 'requires_payment_method',
        ...params,
      };
      intents.set(id, pi);
      if (opts?.idempotencyKey) byKey.set(opts.idempotencyKey, pi);
      stripeCalls.intents.push(params);
      return pi;
    },
    async retrieve(id) {
      return intents.get(id);
    },
    async cancel(id) {
      const pi = intents.get(id);
      pi.status = 'canceled';
      return pi;
    },
  },
  refunds: {
    async create(params) {
      stripeCalls.refunds.push(params);
      return { id: `re_fc_${++seq}`, status: 'succeeded', ...params };
    },
  },
};

class TestAuthGuard {
  canActivate(ctx) {
    const req = ctx.switchToHttp().getRequest();
    const id = req.headers['x-test-user'];
    if (id)
      req.user = {
        id,
        email: 'e2e@youssef-test.example',
        name: 'E2E',
        role: req.headers['x-test-role'] ?? 'user',
        sessionId: 's',
        mustChangePassword: false,
      };
    return true;
  }
}

// Payments needs the hotel tokens to exist; this file only books flights.
class HotelStubs {}
Global()(HotelStubs);
Module({
  providers: [
    {
      provide: HOTEL_BOOKING_LIFECYCLE,
      useValue: {
        confirmBooking: async () => {},
        releaseInventory: async () => {},
      },
    },
    {
      provide: HOTEL_BOOKING_PAYMENT_READER,
      useValue: { getPaymentSnapshot: async () => null },
    },
  ],
  exports: [HOTEL_BOOKING_LIFECYCLE, HOTEL_BOOKING_PAYMENT_READER],
})(HotelStubs);

let mongo, app, db, http, flightBookings, flightChanges;

before(async () => {
  mongo = await MongoMemoryReplSet.create({
    binary: { version: '8.2.6' },
    replSet: { count: 1 },
  });
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [
          () => ({
            STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
            UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'fc-uploads-')),
          }),
        ],
      }),
      MongooseModule.forRoot(mongo.getUri('youssef_flight_changes_tests')),
      UsersModule,
      NotificationsModule,
      UploadsModule,
      HotelStubs,
      FlightBookingsModule,
      PaymentsModule,
      RefundsModule,
    ],
    providers: [
      { provide: APP_GUARD, useClass: TestAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
    ],
  })
    .overrideProvider(STRIPE_CLIENT)
    .useValue(fakeStripe)
    .compile();
  app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  http = app.getHttpServer();
  db = app.get(getConnectionToken());
  flightBookings = app.get(FlightBookingsService);
  flightChanges = app.get(FlightChangesService);
  for (const m of Object.values(db.models)) await m.init();
  await db.collection('airports').insertMany([
    {
      _id: 'CAI',
      iataCode: 'CAI',
      name: 'Cairo',
      cityId: 'x',
      countryCode: 'EG',
      timeZone: 'Africa/Cairo',
    },
    {
      _id: 'LXR',
      iataCode: 'LXR',
      name: 'Luxor',
      cityId: 'y',
      countryCode: 'EG',
      timeZone: 'Africa/Cairo',
    },
  ]);
});

after(async () => {
  if (app) await app.close();
  if (mongo) await mongo.stop();
});

// ---------------------------------------------------------------- helpers
let airlineSeq = 0;
async function airline() {
  const _id = new Types.ObjectId();
  await db.collection('airlines').insertOne({
    _id,
    name: `Air ${++airlineSeq}`,
    code: `Y${airlineSeq}`,
    currency: 'EGP',
    status: 'active',
  });
  await db.collection('airlinepolicies').insertOne({
    airlineId: _id,
    cancellationTiers: [
      { daysBefore: 0, refundPercentage: 20 },
      { daysBefore: 7, refundPercentage: 50 },
    ],
    extraBagPrice: null,
    maxExtraBags: 0,
  });
  return _id;
}

let flightSeq = 0;
async function flight(
  airlineId,
  { days = 30, price = 1000, seatCount = 8, from = 'CAI', to = 'LXR' } = {},
) {
  const _id = new Types.ObjectId();
  const dep = new Date(Date.now() + days * DAY);
  await db.collection('flights').insertOne({
    _id,
    airlineId,
    flightNumber: `YS${++flightSeq}`,
    departureAirport: from,
    arrivalAirport: to,
    departureTime: dep,
    arrivalTime: new Date(dep.getTime() + 3_600_000),
    departureDate: dep.toISOString().slice(0, 10),
    status: 'Scheduled',
    bookingCount: 0,
    inventoryRevision: 0,
  });
  await db.collection('cabininventories').insertOne({
    flightId: _id,
    cabinClass: 'Economy',
    seatCount,
    bookedSeats: 0,
    heldSeats: 0,
    price,
    freeBaggage: 1,
    maxBagWeightKg: 23,
  });
  return String(_id);
}

const passenger = (n, seatNumber) => ({
  fullName: `Passenger ${n}`,
  dateOfBirth: '1990-01-01',
  passportNumber: `P${String(n).padStart(6, '0')}`,
  ...(seatNumber ? { seatNumber } : {}),
});

const as = (user) => ({ 'x-test-user': user });
const cabin = (flightId) =>
  db
    .collection('cabininventories')
    .findOne({ flightId: new Types.ObjectId(flightId) });

function hold(user, flightId, passengers) {
  return request(http)
    .post('/api/flight-bookings/hold')
    .set(as(user))
    .send({ flightId, cabinClass: 'Economy', passengers });
}

async function webhook(type, object) {
  const payload = JSON.stringify({
    id: `evt_fc_${++seq}`,
    object: 'event',
    type,
    data: { object },
  });
  const header = signer.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return request(http)
    .post('/api/payments/webhook')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', header)
    .send(payload);
}

/** Accept policies, create the PaymentIntent and deliver payment_intent.succeeded. */
async function pay(user, bookingId) {
  const a = await request(http)
    .post(`/api/bookings/flight/${bookingId}/accept-policies`)
    .set(as(user))
    .send({ accepted: true });
  assert.ok(a.status < 300, JSON.stringify(a.body));
  const p = await request(http)
    .post('/api/payments')
    .set(as(user))
    .send({ bookingType: 'flight', bookingId });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  const pi = p.body.stripePaymentIntentId;
  const w = await webhook('payment_intent.succeeded', {
    id: pi,
    object: 'payment_intent',
    amount_received: intents.get(pi).amount,
    currency: 'egp',
    status: 'succeeded',
  });
  assert.equal(w.status, 200);
  return p.body;
}

async function confirmedBooking(user, flightId, passengers = [passenger(1)]) {
  const h = await hold(user, flightId, passengers);
  assert.equal(h.status, 201, JSON.stringify(h.body));
  await pay(user, h.body.bookingId);
  const b = await request(http)
    .get(`/api/flight-bookings/${h.body.bookingId}`)
    .set(as(user));
  assert.equal(b.body.status, 'Confirmed');
  return b.body;
}

// ================================================================ FLT-28 seats

test('FLT-28: seat map is public, rows of 6, and shows taken seats', async () => {
  const f = await flight(await airline(), { seatCount: 8 });
  const user = newUser();
  const h = await hold(user, f, [passenger(1, '2B'), passenger(2)]);
  assert.equal(h.status, 201, JSON.stringify(h.body));
  assert.deepEqual(
    h.body.passengers.map((p) => p.seatNumber ?? null),
    ['2B', null],
  ); // summary shows choices only

  const res = await request(http).get(
    `/api/flights/${f}/seats?cabinClass=Economy`,
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.seatsPerRow, 6);
  assert.deepEqual(
    res.body.rows.map((r) => r.seats.length),
    [6, 2],
  );
  const taken = res.body.rows
    .flatMap((r) => r.seats)
    .filter((s) => !s.available)
    .map((s) => s.seatNumber);
  assert.deepEqual(taken.sort(), ['1A', '2B']); // the passenger without a choice got the first free seat
  assert.equal(res.body.availableSeats, 6);

  const booking = await request(http)
    .get(`/api/flight-bookings/${h.body.bookingId}`)
    .set(as(user));
  assert.deepEqual(
    booking.body.passengers.map((p) => p.seatNumber),
    ['2B', '1A'],
  );
});

test('FLT-28: a taken, unknown or doubled seat is refused', async () => {
  const f = await flight(await airline(), { seatCount: 8 });
  assert.equal((await hold(newUser(), f, [passenger(1, '1C')])).status, 201);

  const taken = await hold(newUser(), f, [passenger(2, '1C')]);
  assert.equal(taken.status, 409);
  assert.equal(taken.body.code, 'SEAT_TAKEN');

  const missing = await hold(newUser(), f, [passenger(3, '2C')]); // seat 9 of an 8-seat cabin
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, 'INVALID_SEAT');

  const twice = await hold(newUser(), f, [
    passenger(4, '1D'),
    passenger(5, '1D'),
  ]);
  assert.equal(twice.status, 400);
  assert.equal(twice.body.code, 'INVALID_SEAT');

  const bad = await hold(newUser(), f, [passenger(6, '1Z')]);
  assert.equal(bad.status, 400); // DTO format check
  assert.equal((await cabin(f)).heldSeats, 1); // the refused requests held nothing
});

test('FLT-28: 6 people racing for the same seat -> exactly one gets it', async () => {
  const f = await flight(await airline(), { seatCount: 8 });
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      hold(newUser(), f, [passenger(10 + i, '1F')]),
    ),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.ok(
    results.filter((r) => r.status !== 201).every((r) => r.status === 409),
  );
  assert.equal((await cabin(f)).heldSeats, 1);
  assert.equal(
    await db
      .collection('seatassignments')
      .countDocuments({ flightId: new Types.ObjectId(f) }),
    1,
  );
});

test('FLT-28: seats are freed when the hold expires or the booking is cancelled', async () => {
  const f = await flight(await airline(), { seatCount: 8 });
  const user = newUser();
  const h = await hold(user, f, [passenger(20, '1A')]);
  await db
    .collection('flightbookings')
    .updateOne(
      { _id: new Types.ObjectId(h.body.bookingId) },
      { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
    );
  await flightBookings.expireOverdueHolds();
  assert.equal((await hold(newUser(), f, [passenger(21, '1A')])).status, 201); // seat free again

  const b = await confirmedBooking(user, f, [passenger(22, '2A')]);
  const c = await request(http)
    .post(`/api/flight-bookings/${b._id}/cancel`)
    .set(as(user))
    .send({ confirm: true });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal((await hold(newUser(), f, [passenger(23, '2A')])).status, 201);
});

test('FLT-28: moving passengers to other seats; e-ticket data shows the seat', async () => {
  const f = await flight(await airline(), { seatCount: 8 });
  const user = newUser();
  const b = await confirmedBooking(user, f, [
    passenger(30, '1A'),
    passenger(31, '1B'),
  ]);
  await hold(newUser(), f, [passenger(32, '1C')]);

  const swap = await request(http)
    .patch(`/api/flight-bookings/${b._id}/seats`)
    .set(as(user))
    .send({
      seats: [
        { passportNumber: 'P000030', seatNumber: '1B' },
        { passportNumber: 'P000031', seatNumber: '1A' },
      ],
    });
  assert.equal(swap.status, 200, JSON.stringify(swap.body));
  assert.deepEqual(
    swap.body.passengers.map((p) => p.seatNumber),
    ['1B', '1A'],
  );

  const takenSeat = await request(http)
    .patch(`/api/flight-bookings/${b._id}/seats`)
    .set(as(user))
    .send({ seats: [{ passportNumber: 'P000030', seatNumber: '1C' }] });
  assert.equal(takenSeat.status, 409);
  assert.equal(takenSeat.body.code, 'SEAT_TAKEN');

  const stranger = await request(http)
    .patch(`/api/flight-bookings/${b._id}/seats`)
    .set(as(newUser()))
    .send({ seats: [{ passportNumber: 'P000030', seatNumber: '2A' }] });
  assert.equal(stranger.status, 404);

  const notOnBooking = await request(http)
    .patch(`/api/flight-bookings/${b._id}/seats`)
    .set(as(user))
    .send({ seats: [{ passportNumber: 'P999999', seatNumber: '2A' }] });
  assert.equal(notOnBooking.status, 400);

  const csvSeats = await db
    .collection('seatassignments')
    .find({ ownerId: new Types.ObjectId(b._id) })
    .toArray();
  assert.deepEqual(csvSeats.map((s) => s.seatNumber).sort(), ['1A', '1B']);
});

// ============================================================ FLT-27 changes

const changeTo = (user, bookingId, newFlightId, seats) =>
  request(http)
    .post(`/api/flight-bookings/${bookingId}/change`)
    .set(as(user))
    .send({ newFlightId, ...(seats ? { seats } : {}) });
const booking = (user, id) =>
  request(http)
    .get(`/api/flight-bookings/${id}`)
    .set(as(user))
    .then((r) => r.body);

test('FLT-27: cheaper flight -> applied at once, seats move, difference refunded', async () => {
  const air = await airline();
  const f1 = await flight(air, { price: 1000 });
  const f2 = await flight(air, { price: 700, days: 31 });
  const user = newUser();
  const b = await confirmedBooking(user, f1, [passenger(40), passenger(41)]);
  const refundsBefore = stripeCalls.refunds.length;

  const q = await request(http)
    .get(`/api/flight-bookings/${b._id}/change-quote?newFlightId=${f2}`)
    .set(as(user));
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.action, 'refund');
  assert.equal(q.body.amount, 600);
  assert.equal((await cabin(f2)).heldSeats, 0); // a quote reserves nothing

  const c = await changeTo(user, b._id, f2, [
    { passportNumber: 'P000041', seatNumber: '2A' },
  ]);
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.status, 'Applied');
  assert.equal(c.body.fareDifference, -600);
  assert.equal(c.body.refund.amount, 600);

  const after = await booking(user, b._id);
  assert.equal(after.flightId, f2);
  assert.equal(after.reference, b.reference); // same booking, same reference
  assert.equal(after.totalAmount, 1400);
  assert.deepEqual(
    after.passengers.map((p) => p.seatNumber),
    ['1A', '2A'],
  );
  assert.equal((await cabin(f1)).bookedSeats, 0);
  assert.deepEqual(
    [(await cabin(f2)).bookedSeats, (await cabin(f2)).heldSeats],
    [2, 0],
  );
  assert.equal(
    await db
      .collection('seatassignments')
      .countDocuments({ flightId: new Types.ObjectId(f1) }),
    0,
  );
  assert.deepEqual(
    stripeCalls.refunds.slice(refundsBefore).map((r) => r.amount),
    [60000],
  );
});

test('FLT-27: dearer flight -> seats held, difference paid via Stripe, then a cancellation refunds both payments', async () => {
  const air = await airline();
  const f1 = await flight(air, { price: 1000 });
  const f3 = await flight(air, { price: 1300, days: 32 });
  const user = newUser();
  const b = await confirmedBooking(user, f1, [passenger(50), passenger(51)]);

  const c = await changeTo(user, b._id, f3);
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.status, 'Pending Payment');
  assert.equal(c.body.amountDue, 600);
  assert.equal((await cabin(f3)).heldSeats, 2);
  assert.equal((await booking(user, b._id)).flightId, f1); // nothing moves before payment

  const again = await changeTo(user, b._id, f3);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'CHANGE_ALREADY_PENDING');

  const payment = await pay(user, c.body.changeId); // policies + PaymentIntent + webhook
  assert.equal(payment.amount, 600);

  const after = await booking(user, b._id);
  assert.equal(after.flightId, f3);
  assert.equal(after.totalAmount, 2600);
  assert.deepEqual(
    [(await cabin(f3)).bookedSeats, (await cabin(f3)).heldSeats],
    [2, 0],
  );
  assert.equal((await cabin(f1)).bookedSeats, 0);

  // 32 days ahead -> 50% tier of what was paid in total (2000 + 600), split
  // over the newest payment first (600) and then the original one (700).
  const refundsBefore = stripeCalls.refunds.length;
  const cancel = await request(http)
    .post(`/api/flight-bookings/${b._id}/cancel`)
    .set(as(user))
    .send({ confirm: true });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  assert.equal(cancel.body.refund.amount, 1300);
  assert.deepEqual(
    stripeCalls.refunds.slice(refundsBefore).map((r) => r.amount),
    [60000, 70000],
  );
  assert.equal((await cabin(f3)).bookedSeats, 0);
});

test('FLT-27: same route, same airline, other flight, seats available, my booking only', async () => {
  const air = await airline();
  const f1 = await flight(air, { price: 1000 });
  const otherRoute = await flight(air, { from: 'LXR', to: 'CAI' });
  const otherAirline = await flight(await airline());
  const full = await flight(air, { seatCount: 1 });
  await hold(newUser(), full, [passenger(60)]);
  const user = newUser();
  const b = await confirmedBooking(user, f1, [passenger(61)]);

  for (const [target, status, code] of [
    [otherRoute, 400, 'INVALID_FLIGHT_CHANGE'],
    [otherAirline, 400, 'INVALID_FLIGHT_CHANGE'],
    [f1, 400, 'INVALID_FLIGHT_CHANGE'],
    [full, 409, 'SEATS_UNAVAILABLE'],
  ]) {
    const r = await changeTo(user, b._id, target);
    assert.equal(r.status, status, `${target}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, code);
  }
  assert.equal((await changeTo(newUser(), b._id, otherRoute)).status, 404);
});

test('FLT-27: an unpaid change expires and gives its seats back; the booking is untouched', async () => {
  const air = await airline();
  const f1 = await flight(air, { price: 1000 });
  const f2 = await flight(air, { price: 1500 });
  const user = newUser();
  const b = await confirmedBooking(user, f1, [passenger(70)]);
  const c = await changeTo(user, b._id, f2);
  await db
    .collection('flightchanges')
    .updateOne(
      { _id: new Types.ObjectId(c.body.changeId) },
      { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
    );
  assert.equal(await flightChanges.expireOverdue(), 1);

  const list = await request(http)
    .get(`/api/flight-bookings/${b._id}/changes`)
    .set(as(user));
  assert.equal(list.body[0].status, 'Expired');
  assert.equal((await cabin(f2)).heldSeats, 0);
  assert.equal(
    await db
      .collection('seatassignments')
      .countDocuments({ flightId: new Types.ObjectId(f2) }),
    0,
  );
  assert.equal((await booking(user, b._id)).flightId, f1);
});

test('FLT-27: booking cancelled while the difference is being paid -> change dropped, late money refunded in full', async () => {
  const air = await airline();
  const f1 = await flight(air, { price: 1000 });
  const f2 = await flight(air, { price: 1200 });
  const user = newUser();
  const b = await confirmedBooking(user, f1, [passenger(80)]);
  const c = await changeTo(user, b._id, f2);
  const changeId = c.body.changeId;
  await request(http)
    .post(`/api/bookings/flight/${changeId}/accept-policies`)
    .set(as(user))
    .send({ accepted: true });
  const p = await request(http)
    .post('/api/payments')
    .set(as(user))
    .send({ bookingType: 'flight', bookingId: changeId });
  assert.equal(p.status, 201, JSON.stringify(p.body));

  const cancel = await request(http)
    .post(`/api/flight-bookings/${b._id}/cancel`)
    .set(as(user))
    .send({ confirm: true });
  assert.equal(cancel.status, 200);
  assert.equal((await cabin(f2)).heldSeats, 0); // the change was dropped with the booking

  const refundsBefore = stripeCalls.refunds.length;
  const pi = p.body.stripePaymentIntentId;
  const w = await webhook('payment_intent.succeeded', {
    id: pi,
    object: 'payment_intent',
    amount_received: intents.get(pi).amount,
    currency: 'egp',
    status: 'succeeded',
  });
  assert.equal(w.status, 200);
  assert.deepEqual(
    stripeCalls.refunds.slice(refundsBefore).map((r) => r.amount),
    [20000],
  );
  assert.equal((await booking(user, b._id)).status, 'Cancelled');
});

test('FLT-27: 5 parallel change requests on one booking -> exactly one change, seats held once', async () => {
  const air = await airline();
  const f1 = await flight(air, { price: 1000 });
  const f2 = await flight(air, { price: 1100 });
  const user = newUser();
  const b = await confirmedBooking(user, f1, [passenger(90)]);
  const results = await Promise.all(
    Array.from({ length: 5 }, () => changeTo(user, b._id, f2)),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.ok(
    results.filter((r) => r.status !== 201).every((r) => r.status === 409),
  );
  assert.equal((await cabin(f2)).heldSeats, 1);
});

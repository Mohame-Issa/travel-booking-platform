// Youssef Khafagy: payments and refunds end to end (PAY-01..PAY-04) on the REAL
// hotel booking, notification, payment and refund modules, against a disposable
// local replica set. Never loads .env or touches the shared database.
//
// Stripe: API calls (PaymentIntents, Refunds) go to an in-memory fake, so no
// network and no key is needed. Webhooks are signed and verified with the real
// Stripe SDK over the raw request body, exactly like in production.
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
  FLIGHT_BOOKING_LIFECYCLE,
  FLIGHT_BOOKING_PAYMENT_READER,
  REFUND_SERVICE,
} from '../dist/common/interfaces/index.js';
import { createValidationPipe } from '../dist/common/pipes/validation.pipe.js';
import { HotelBookingsModule } from '../dist/hotel-bookings/hotel-bookings.module.js';
import { HotelBookingsService } from '../dist/hotel-bookings/hotel-bookings.service.js';
import { HotelsCatalogueModule } from '../dist/hotels/hotels-catalogue.module.js';
import { HotelsModule } from '../dist/hotels/hotels.module.js';
import { NotificationsModule } from '../dist/notifications/notifications.module.js';
import { PaymentExpiryService } from '../dist/payments/payment-expiry.service.js';
import { STRIPE_CLIENT } from '../dist/payments/payments.constants.js';
import { PaymentsModule } from '../dist/payments/payments.module.js';
import { RefundsModule } from '../dist/refunds/refunds.module.js';
import { UploadsModule } from '../dist/uploads/uploads.module.js';
import { UsersModule } from '../dist/users/users.module.js';

const WEBHOOK_SECRET = 'whsec_e2e_test_only';
const DAY = 86_400_000;
const day = (n) => new Date(Date.UTC(2099, 0, 1) + n * DAY);
const iso = (n) => day(n).toISOString().slice(0, 10);
const newUser = () => String(new Types.ObjectId());

// ---------------------------------------------------------------- fake Stripe
// Only the API calls are faked. webhooks.* stays the real SDK implementation.
const signer = new Stripe('sk_test_e2e_dummy_never_used_for_network');
const stripeCalls = { intents: [], refunds: [], cancelled: [] };
const intents = new Map();
const byIdempotencyKey = new Map();
let seq = 0;
const fakeStripe = {
  webhooks: signer.webhooks,
  paymentIntents: {
    async create(params, opts) {
      if (opts?.idempotencyKey && byIdempotencyKey.has(opts.idempotencyKey))
        return byIdempotencyKey.get(opts.idempotencyKey);
      const id = `pi_e2e_${++seq}`;
      const pi = {
        id,
        client_secret: `${id}_secret_x`,
        status: 'requires_payment_method',
        ...params,
      };
      intents.set(id, pi);
      if (opts?.idempotencyKey) byIdempotencyKey.set(opts.idempotencyKey, pi);
      stripeCalls.intents.push(params);
      return pi;
    },
    async retrieve(id) {
      return intents.get(id);
    },
    async cancel(id) {
      const pi = intents.get(id);
      pi.status = 'canceled';
      stripeCalls.cancelled.push(id);
      return pi;
    },
  },
  refunds: {
    async create(params) {
      stripeCalls.refunds.push(params);
      return { id: `re_e2e_${++seq}`, status: 'succeeded', ...params };
    },
  },
};

// ------------------------------------------- test auth (stands in for AuthGuard)
// The real AuthGuard needs session cookies; here the caller is chosen with the
// x-test-user header. The real RolesGuard and @CheckOwnership still run.
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

// Flight bookings are covered by their own module; payments only needs the
// tokens to exist here because this test pays for hotel reservations.
class FlightStubs {}
Global()(FlightStubs);
Module({
  providers: [
    {
      provide: FLIGHT_BOOKING_LIFECYCLE,
      useValue: {
        confirmBooking: async () => {},
        releaseInventory: async () => {},
      },
    },
    {
      provide: FLIGHT_BOOKING_PAYMENT_READER,
      useValue: { getPaymentSnapshot: async () => null },
    },
  ],
  exports: [FLIGHT_BOOKING_LIFECYCLE, FLIGHT_BOOKING_PAYMENT_READER],
})(FlightStubs);

let mongo, app, db, http, hotelBookings, expiry, refunds;

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
            UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'pay-uploads-')),
          }),
        ],
      }),
      MongooseModule.forRoot(mongo.getUri('youssef_payments_tests')),
      UsersModule,
      NotificationsModule,
      UploadsModule,
      HotelsCatalogueModule,
      HotelBookingsModule,
      HotelsModule,
      FlightStubs,
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
  hotelBookings = app.get(HotelBookingsService);
  expiry = app.get(PaymentExpiryService);
  refunds = app.get(REFUND_SERVICE);
  for (const m of Object.values(db.models)) await m.init();
});

after(async () => {
  if (app) await app.close();
  if (mongo) await mongo.stop();
});

// ---------------------------------------------------------------- helpers
async function hotelReservation({
  userId,
  tiers = [
    { daysBefore: 0, refundPercentage: 25 },
    { daysBefore: 7, refundPercentage: 50 },
  ],
}) {
  const hotel = await db.model('Hotel').create({
    name: `PayHotel ${Math.random()}`,
    address: 'Nile St',
    cityId: 'CAI',
    countryCode: 'EG',
    starClass: 4,
    currency: 'EGP',
  });
  await db
    .model('HotelPolicy')
    .create({
      hotelId: hotel._id,
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationTiers: tiers,
    });
  const room = await db
    .model('Room')
    .create({
      hotelId: hotel._id,
      roomNumber: '101',
      type: 'Double',
      beds: 1,
      maxOccupancy: 2,
      pricePerNight: 1000,
    });
  await db
    .model('RoomAvailability')
    .create({
      roomId: room._id,
      startDate: day(0),
      endDate: day(30),
      kind: 'Available',
    });
  // 3 nights x 1000 EGP = 3000 EGP (HTL-16)
  const booking = await hotelBookings.create(
    {
      hotelId: String(hotel._id),
      checkInDate: iso(1),
      checkOutDate: iso(4),
      rooms: [{ roomId: String(room._id), adults: 1, childrenAges: [] }],
    },
    userId,
  );
  return String(booking._id);
}

const as = (userId) => ({ 'x-test-user': userId });
const get = (path, userId) => request(http).get(`/api${path}`).set(as(userId));
const post = (path, userId, body) =>
  request(http)
    .post(`/api${path}`)
    .set(as(userId))
    .send(body ?? {});

async function webhook(type, object, eventId = `evt_e2e_${++seq}`) {
  const payload = JSON.stringify({
    id: eventId,
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
const succeeded = (pi) => ({
  id: pi,
  object: 'payment_intent',
  amount_received: intents.get(pi).amount,
  currency: 'egp',
  status: 'succeeded',
});
const failed = (pi) => ({
  id: pi,
  object: 'payment_intent',
  amount_received: 0,
  currency: 'egp',
  status: 'requires_payment_method',
});

async function acceptAndPay(userId, bookingId) {
  assert.equal(
    (
      await post(`/bookings/hotel/${bookingId}/accept-policies`, userId, {
        accepted: true,
      })
    ).status,
    200,
  );
  const res = await post('/payments', userId, {
    bookingType: 'hotel',
    bookingId,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}
const bookingStatus = async (id) =>
  (await db.model('HotelBooking').findById(id).lean()).status;

// ------------------------------------------------------------------ tests
test('full flow: policies -> pay -> decline -> retry -> webhook confirms -> cancel -> refund (PAY-01..04)', async () => {
  const owner = newUser();
  const other = newUser();
  const bookingId = await hotelReservation({ userId: owner });

  // PAY-02: policies shown to the owner only
  const pol = await get(`/bookings/hotel/${bookingId}/policies`, owner);
  assert.equal(pol.status, 200);
  assert.equal(pol.body.checkInTime, '14:00');
  assert.deepEqual(
    pol.body.cancellationTiers.map((t) => t.daysBefore),
    [0, 7],
  );
  assert.equal(pol.body.accepted, false);
  assert.equal(
    (await get(`/bookings/hotel/${bookingId}/policies`, other)).body.code,
    'NOT_RESOURCE_OWNER',
  );

  // PAY-02: payment blocked until accepted
  const blocked = await post('/payments', owner, {
    bookingType: 'hotel',
    bookingId,
  });
  assert.equal(blocked.body.code, 'POLICIES_NOT_ACCEPTED');

  // PAY-01: amount computed by the server (never sent by the client), PAY-04: EGP
  assert.equal(
    (
      await post('/payments', owner, {
        bookingType: 'hotel',
        bookingId,
        amount: 1,
      })
    ).status,
    400,
  );
  const payment = await acceptAndPay(owner, bookingId);
  assert.equal(payment.amountMinor, 300000);
  assert.equal(payment.currency, 'EGP');
  assert.equal(payment.status, 'pending');
  assert.ok(payment.clientSecret);
  assert.equal(stripeCalls.intents.at(-1).amount, 300000);
  // double click: same payment, same PaymentIntent
  const again = await post('/payments', owner, {
    bookingType: 'hotel',
    bookingId,
  });
  assert.equal(again.body.id, payment.id);
  assert.equal(again.body.stripePaymentIntentId, payment.stripePaymentIntentId);
  assert.equal(
    (await get(`/payments/${payment.id}`, other)).body.code,
    'NOT_RESOURCE_OWNER',
  );

  // Card declined: payment failed, booking still held (user may retry, PAY-01)
  assert.equal(
    (
      await webhook(
        'payment_intent.payment_failed',
        failed(payment.stripePaymentIntentId),
      )
    ).status,
    200,
  );
  assert.equal(
    (await get(`/payments/${payment.id}`, owner)).body.status,
    'failed',
  );
  assert.equal(await bookingStatus(bookingId), 'Pending Payment');

  // Retry reuses the same PaymentIntent
  const retry = await post(`/payments/${payment.id}/retry`, owner);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.status, 'pending');
  assert.equal(retry.body.stripePaymentIntentId, payment.stripePaymentIntentId);

  // Verified success via the signed webhook -> booking Confirmed (HTL-17)
  const evt = `evt_e2e_success_${bookingId}`;
  assert.equal(
    (
      await webhook(
        'payment_intent.succeeded',
        succeeded(payment.stripePaymentIntentId),
        evt,
      )
    ).status,
    200,
  );
  const paid = (await get(`/payments/${payment.id}`, owner)).body;
  assert.equal(paid.status, 'succeeded');
  assert.ok(paid.succeededAt);
  assert.equal(await bookingStatus(bookingId), 'Confirmed');

  // Replayed event: skipped, nothing confirmed twice
  const replay = await webhook(
    'payment_intent.succeeded',
    succeeded(payment.stripePaymentIntentId),
    evt,
  );
  assert.deepEqual(replay.body, { received: true, duplicate: true });
  assert.equal(
    await db
      .model('Notification')
      .countDocuments({
        type: 'booking_confirmed',
        'data.bookingId': bookingId,
      }),
    1,
  );

  // Cancellation (the steps Omar Hashem's HTL-21 endpoint performs), then refund (PAY-03)
  await hotelBookings.releaseInventory({ bookingId, reason: 'cancelled' });
  assert.equal(await bookingStatus(bookingId), 'Cancelled');
  const result = await refunds.createRefund({
    bookingType: 'hotel',
    bookingId,
    reason: 'user_cancellation',
    requestedBy: owner,
  });
  assert.equal(result.amount, 1500); // 7-day tier (HTL-10/FLT-09) = 50% of 3000 EGP
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(stripeCalls.refunds.at(-1), {
    payment_intent: payment.stripePaymentIntentId,
    amount: 150000,
  });
  // idempotent: a second call returns the same refund, no second Stripe refund
  const before = stripeCalls.refunds.length;
  assert.equal(
    (
      await refunds.createRefund({
        bookingType: 'hotel',
        bookingId,
        reason: 'user_cancellation',
      })
    ).refundId,
    result.refundId,
  );
  assert.equal(stripeCalls.refunds.length, before);

  // GET /api/refunds/:id: status label, tier, owner only
  const view = await get(`/refunds/${result.refundId}`, owner);
  assert.equal(view.status, 200);
  assert.equal(view.body.statusLabel, 'Refunded');
  assert.equal(view.body.refundPercentage, 50);
  assert.equal(view.body.appliedTierDaysBefore, 7);
  assert.equal(
    (await get(`/refunds/${result.refundId}`, other)).body.code,
    'NOT_RESOURCE_OWNER',
  );
  assert.equal(
    await db
      .model('Notification')
      .countDocuments({ type: 'refund_issued', userId: owner }),
    1,
  );
});

test('forged or unsigned webhooks are rejected and confirm nothing', async () => {
  const forged = await request(http)
    .post('/api/payments/webhook')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', 't=1,v1=forged')
    .send(
      JSON.stringify({
        id: 'evt_forged',
        type: 'payment_intent.succeeded',
        data: { object: {} },
      }),
    );
  assert.equal(forged.status, 400);
  assert.equal(forged.body.code, 'INVALID_WEBHOOK_SIGNATURE');
  const unsigned = await request(http)
    .post('/api/payments/webhook')
    .set('Content-Type', 'application/json')
    .send('{}');
  assert.equal(unsigned.body.code, 'INVALID_WEBHOOK_SIGNATURE');
});

test('hold expiry: PaymentIntent cancelled, payment cancelled, rooms released (PAY-01, HTL-18)', async () => {
  const owner = newUser();
  const bookingId = await hotelReservation({ userId: owner });
  const payment = await acceptAndPay(owner, bookingId);

  const past = new Date(Date.now() - 60 * 60_000);
  await db
    .model('Payment')
    .updateOne({ _id: payment.id }, { holdExpiresAt: past });
  await expiry.runOnce();

  assert.ok(stripeCalls.cancelled.includes(payment.stripePaymentIntentId));
  const saved = await db.model('Payment').findById(payment.id).lean();
  assert.equal(saved.status, 'cancelled');
  assert.ok(saved.releasedAt);
  assert.equal(await bookingStatus(bookingId), 'Expired');
  // retry is no longer possible
  assert.equal(
    (await post(`/payments/${payment.id}/retry`, owner)).body.code,
    'PAYMENT_NOT_RETRYABLE',
  );
});

test('payment arriving after the hold expired is refunded in full, booking not confirmed (GEN-11)', async () => {
  const owner = newUser();
  const bookingId = await hotelReservation({ userId: owner });
  const payment = await acceptAndPay(owner, bookingId);

  // The hold ran out (beyond Hashad's webhook grace) before Stripe reported success.
  const past = new Date(Date.now() - 60 * 60_000);
  await db
    .model('HotelBooking')
    .updateOne({ _id: bookingId }, { holdExpiresAt: past });
  assert.equal(
    (
      await webhook(
        'payment_intent.succeeded',
        succeeded(payment.stripePaymentIntentId),
      )
    ).status,
    200,
  );

  assert.notEqual(await bookingStatus(bookingId), 'Confirmed');
  const refund = await db.model('Refund').findOne({ bookingId }).lean();
  assert.equal(refund.reason, 'late_payment');
  assert.equal(refund.amountMinor, 300000);
  assert.deepEqual(stripeCalls.refunds.at(-1), {
    payment_intent: payment.stripePaymentIntentId,
    amount: 300000,
  });
});

test('a 0% cancellation creates no refund at all (PAY-03)', async () => {
  const owner = newUser();
  // Only a tier far beyond the stay date: none applies, so 0% (FLT-09 / HTL-10).
  const bookingId = await hotelReservation({
    userId: owner,
    tiers: [{ daysBefore: 999999, refundPercentage: 100 }],
  });
  const payment = await acceptAndPay(owner, bookingId);
  await webhook(
    'payment_intent.succeeded',
    succeeded(payment.stripePaymentIntentId),
  );
  assert.equal(await bookingStatus(bookingId), 'Confirmed');

  await hotelBookings.releaseInventory({ bookingId, reason: 'cancelled' });
  const before = stripeCalls.refunds.length;
  const result = await refunds.createRefund({
    bookingType: 'hotel',
    bookingId,
    reason: 'user_cancellation',
    requestedBy: owner,
  });
  assert.deepEqual(result, {
    refundId: null,
    amount: 0,
    currency: 'EGP',
    status: 'none',
  });
  assert.equal(await db.model('Refund').countDocuments({ bookingId }), 0);
  assert.equal(stripeCalls.refunds.length, before);
});

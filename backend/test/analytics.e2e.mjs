// Youssef Khafagy: BON-01 admin analytics end to end against a disposable
// local replica set, with hand-made bookings and refunds so the expected
// numbers are known exactly. Never loads .env or touches the shared database.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import request from 'supertest';
import { AnalyticsModule } from '../dist/analytics/analytics.module.js';
import { AllExceptionsFilter } from '../dist/common/filters/all-exceptions.filter.js';
import { RolesGuard } from '../dist/common/guards/roles.guard.js';
import { createValidationPipe } from '../dist/common/pipes/validation.pipe.js';

class TestAuthGuard {
  canActivate(ctx) {
    const req = ctx.switchToHttp().getRequest();
    const id = req.headers['x-test-user'];
    if (id)
      req.user = {
        id,
        email: 'x',
        name: 'x',
        role: req.headers['x-test-role'] ?? 'user',
        sessionId: 's',
        mustChangePassword: false,
      };
    return true;
  }
}

let mongo, app, db, http;
const admin = {
  'x-test-user': String(new Types.ObjectId()),
  'x-test-role': 'admin',
};
const airA = new Types.ObjectId();
const airB = new Types.ObjectId();
const hotelH = new Types.ObjectId();
const d = (iso) => new Date(`${iso}T12:00:00.000Z`);

before(async () => {
  mongo = await MongoMemoryReplSet.create({
    binary: { version: '8.2.6' },
    replSet: { count: 1 },
  });
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      MongooseModule.forRoot(mongo.getUri('youssef_analytics_tests')),
      AnalyticsModule,
    ],
    providers: [
      { provide: APP_GUARD, useClass: TestAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
    ],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  http = app.getHttpServer();
  db = app.get(getConnectionToken());

  await db.collection('airlines').insertMany([
    { _id: airA, name: 'Alpha Air' },
    { _id: airB, name: 'Beta Air' },
  ]);
  await db.collection('hotels').insertOne({ _id: hotelH, name: 'Nile Hotel' });
  const fb = (airlineId, totalAmount, status, confirmedAt) => ({
    _id: new Types.ObjectId(),
    airlineId,
    totalAmount,
    status,
    confirmedAt,
  });
  const a1 = fb(airA, 1000, 'Confirmed', d('2026-11-05'));
  const a2 = fb(airA, 2000, 'Cancelled', d('2026-11-06')); // cancelled later, refunded 500
  const a3 = fb(airA, 4000, 'Completed', d('2026-10-01')); // outside the period
  const a4 = fb(airA, 9999, 'Expired', null); // never confirmed: never counts
  const b1 = fb(airB, 300, 'Cancelled', d('2026-11-10')); // refund FAILED: not subtracted
  await db.collection('flightbookings').insertMany([a1, a2, a3, a4, b1]);
  const h1 = {
    _id: new Types.ObjectId(),
    hotelId: hotelH,
    totalAmount: 5000,
    status: 'Confirmed',
    confirmedAt: d('2026-11-20'),
  };
  await db.collection('hotelbookings').insertOne(h1);
  await db.collection('refunds').insertMany([
    {
      bookingType: 'flight',
      bookingId: a2._id,
      reason: 'user_cancellation',
      status: 'succeeded',
      amountMinor: 50000,
    },
    {
      bookingType: 'flight',
      bookingId: b1._id,
      reason: 'user_cancellation',
      status: 'failed',
      amountMinor: 30000,
    },
    {
      bookingType: 'flight',
      bookingId: a1._id,
      reason: 'fare_difference',
      status: 'succeeded',
      amountMinor: 10000,
    }, // already in totalAmount
  ]);
});

after(async () => {
  if (app) await app.close();
  if (mongo) await mongo.stop();
});

const get = (qs, headers = admin) =>
  request(http).get(`/api/admin/analytics${qs}`).set(headers);

test('BON-01: bookings and revenue per provider over the period, highest net revenue first', async () => {
  const res = await get('?from=2026-11-01&to=2026-11-30');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.currency, 'EGP');
  assert.deepEqual(
    res.body.items.map((r) => [
      r.providerType,
      r.name,
      r.bookings,
      r.cancelled,
      r.grossRevenue,
      r.refunds,
      r.netRevenue,
    ]),
    [
      ['hotel', 'Nile Hotel', 1, 0, 5000, 0, 5000],
      ['airline', 'Alpha Air', 2, 1, 3000, 500, 2500],
      ['airline', 'Beta Air', 1, 1, 300, 0, 300],
    ],
  );
  assert.deepEqual(res.body.totals, {
    bookings: 4,
    cancelled: 2,
    grossRevenue: 8300,
    refunds: 500,
    netRevenue: 7800,
  });
  assert.deepEqual(res.body.meta, {
    page: 1,
    pageSize: 10,
    totalItems: 3,
    totalPages: 1,
  });
});

test('BON-01: the period and provider type filter the figures; "to" is included', async () => {
  const oneDay = await get('?from=2026-11-06&to=2026-11-06');
  assert.deepEqual(
    oneDay.body.items.map((r) => [r.name, r.bookings]),
    [['Alpha Air', 1]],
  );
  const october = await get(
    '?from=2026-10-01&to=2026-10-31&providerType=airline',
  );
  assert.deepEqual(
    october.body.items.map((r) => [r.name, r.grossRevenue]),
    [['Alpha Air', 4000]],
  );
  const hotelsOnly = await get(
    '?from=2026-11-01&to=2026-11-30&providerType=hotel',
  );
  assert.deepEqual(
    hotelsOnly.body.items.map((r) => r.providerType),
    ['hotel'],
  );
});

test('BON-01: admins only, and "from" must not be after "to"', async () => {
  const user = await get('', { 'x-test-user': String(new Types.ObjectId()) });
  assert.equal(user.status, 403);
  const bad = await get('?from=2026-12-01&to=2026-11-01');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'INVALID_DATE_RANGE');
  const notADate = await get('?from=yesterday');
  assert.equal(notADate.status, 400);
});

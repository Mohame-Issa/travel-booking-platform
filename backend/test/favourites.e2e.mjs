// Youssef Khafagy: BON-02 favourites end to end against a disposable local
// replica set. Never loads .env or touches the shared database.

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
import request from 'supertest';
import { FavouritesModule } from '../dist/favourites/favourites.module.js';
import { AllExceptionsFilter } from '../dist/common/filters/all-exceptions.filter.js';
import { RolesGuard } from '../dist/common/guards/roles.guard.js';
import {
  FLIGHT_BOOKING_PAYMENT_READER,
  HOTEL_BOOKING_PAYMENT_READER,
} from '../dist/common/interfaces/index.js';
import { createValidationPipe } from '../dist/common/pipes/validation.pipe.js';
import {
  FLIGHT_BOOKING_HISTORY_READER,
  PendingFlightBookingHistoryReader,
} from '../dist/flights/flight-booking-history.interface.js';
import { UploadsModule } from '../dist/uploads/uploads.module.js';
import { UploadsService } from '../dist/uploads/uploads.service.js';
import { UsersModule } from '../dist/users/users.module.js';

class TestAuthGuard {
  canActivate(ctx) {
    const req = ctx.switchToHttp().getRequest();
    const id = req.headers['x-test-user'];
    if (id)
      req.user = {
        id,
        email: 'e2e@youssef-test.example',
        name: 'E2E',
        role: 'user',
        sessionId: 's',
        mustChangePassword: false,
      };
    return true;
  }
}
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

class BookingReaderStub {}
Module({
  providers: [
    {
      provide: FLIGHT_BOOKING_PAYMENT_READER,
      useValue: { getPaymentSnapshot: async () => null },
    },
    {
      provide: HOTEL_BOOKING_PAYMENT_READER,
      useValue: { getPaymentSnapshot: async () => null },
    },
  ],
  exports: [FLIGHT_BOOKING_PAYMENT_READER, HOTEL_BOOKING_PAYMENT_READER],
})(BookingReaderStub);
Global()(BookingReaderStub);

let mongo, app, db, http, uploads;

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
          () => ({ UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'fav-uploads-')) }),
        ],
      }),
      MongooseModule.forRoot(mongo.getUri('favourites_tests')),
      UsersModule,
      UploadsModule,
      HistoryReaderStub,
      BookingReaderStub,
      FavouritesModule,
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
  uploads = app.get(UploadsService);
  for (const m of Object.values(db.models)) await m.init();
});

after(async () => {
  if (app) await app.close();
  if (mongo) await mongo.stop();
});

let seq = 0;
async function user(status = 'active') {
  const _id = new Types.ObjectId();
  await db
    .collection('users')
    .insertOne({
      _id,
      name: `Fav User ${++seq}`,
      email: `fav${seq}@youssef-test.example`,
      status,
      role: 'user',
    });
  return String(_id);
}
async function hotel(name, status = 'active') {
  const _id = new Types.ObjectId();
  await db
    .collection('hotels')
    .insertOne({
      _id,
      name,
      status,
      starClass: 4,
      averageRating: 4.5,
      cityId: 'CAI',
    });
  return String(_id);
}
async function itinerary(authorId, fields = {}) {
  const _id = new Types.ObjectId();
  await db.collection('itineraries').insertOne({
    _id,
    userId: new Types.ObjectId(authorId),
    title: 'Nile trip',
    countries: ['EG'],
    dayCount: 3,
    visibility: 'public',
    hiddenAt: null,
    ...fields,
  });
  return String(_id);
}
const as = (id) => ({ 'x-test-user': id });
const save = (u, targetType, targetId) =>
  request(http)
    .post('/api/favourites')
    .set(as(u))
    .send({ targetType, targetId });
const list = (u, qs = '') =>
  request(http).get(`/api/favourites${qs}`).set(as(u));

test('BON-02: save a hotel and a public itinerary, view them newest first; saving twice is harmless', async () => {
  const me = await user();
  const author = await user();
  const h = await hotel('Nile Hotel');
  const it = await itinerary(author);
  assert.equal((await save(me, 'hotel', h)).status, 201);
  const r = await save(me, 'itinerary', it);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.itinerary.authorName, `Fav User ${seq}`);
  await Promise.all([save(me, 'hotel', h), save(me, 'hotel', h)]); // parallel duplicates

  const res = await list(me);
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.items.map((f) => [f.targetType, f.name, f.available]),
    [
      ['itinerary', 'Nile trip', true],
      ['hotel', 'Nile Hotel', true],
    ],
  );
  assert.equal(res.body.items[1].hotel.averageRating, 4.5);
  assert.deepEqual(
    (await list(me, '?type=hotel')).body.items.map((f) => f.name),
    ['Nile Hotel'],
  );
  assert.equal((await list(await user())).body.items.length, 0); // only my own list
});

test('BON-02: private, hidden or deactivated-author itineraries and deactivated hotels cannot be saved', async () => {
  const me = await user();
  const author = await user();
  const gone = await user('deactivated');
  for (const id of [
    await itinerary(author, { visibility: 'private' }),
    await itinerary(author, { hiddenAt: new Date() }),
    await itinerary(gone),
  ]) {
    const r = await save(me, 'itinerary', id);
    assert.equal(r.status, 404); // never reveal that a private one exists
  }
  assert.equal(
    (await save(me, 'hotel', await hotel('Closed', 'deactivated'))).status,
    404,
  );
  assert.equal(
    (await save(me, 'hotel', String(new Types.ObjectId()))).status,
    404,
  );
  assert.equal(
    (await save(me, 'restaurant', String(new Types.ObjectId()))).status,
    400,
  );
});

test('BON-02: an item that turns private later stays listed as unavailable, without details; removing works', async () => {
  const me = await user();
  const author = await user();
  const it = await itinerary(author, { title: 'Secret later' });
  await save(me, 'itinerary', it);
  await db
    .collection('itineraries')
    .updateOne(
      { _id: new Types.ObjectId(it) },
      { $set: { visibility: 'private' } },
    );
  const [f] = (await list(me)).body.items;
  assert.equal(f.available, false);
  assert.equal(f.name, null); // the private title is not shown
  assert.equal(f.itinerary, null);

  assert.equal(
    (await request(http).delete(`/api/favourites/itinerary/${it}`).set(as(me)))
      .status,
    204,
  );
  assert.equal(
    (await request(http).delete(`/api/favourites/itinerary/${it}`).set(as(me)))
      .status,
    404,
  );
  assert.equal((await list(me)).body.items.length, 0);
});

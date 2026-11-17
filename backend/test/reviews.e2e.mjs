// Hotel reviews (HTL-23, HTL-24; taken over from Omar Rashed's part) on the real
// hotel and reservation modules, against a disposable local replica set.
// Never loads .env or touches the shared database.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import request from 'supertest';
import { AllExceptionsFilter } from '../dist/common/filters/all-exceptions.filter.js';
import { RolesGuard } from '../dist/common/guards/roles.guard.js';
import { createValidationPipe } from '../dist/common/pipes/validation.pipe.js';
import { HotelBookingsModule } from '../dist/hotel-bookings/hotel-bookings.module.js';
import { HotelBookingsService } from '../dist/hotel-bookings/hotel-bookings.service.js';
import { HotelsCatalogueModule } from '../dist/hotels/hotels-catalogue.module.js';
import { HotelsModule } from '../dist/hotels/hotels.module.js';
import { NotificationsModule } from '../dist/notifications/notifications.module.js';
import { ReviewsModule } from '../dist/reviews/reviews.module.js';
import { UploadsModule } from '../dist/uploads/uploads.module.js';
import { UsersModule } from '../dist/users/users.module.js';

const DAY = 86_400_000;
const day = (n) => new Date(Date.UTC(2099, 0, 1) + n * DAY);
const iso = (n) => day(n).toISOString().slice(0, 10);

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

let mongo, app, db, http, bookings;

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
          () => ({ UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'rv-uploads-')) }),
        ],
      }),
      MongooseModule.forRoot(mongo.getUri('review_tests')),
      UsersModule,
      NotificationsModule,
      UploadsModule,
      HotelsCatalogueModule,
      HotelBookingsModule,
      HotelsModule,
      ReviewsModule,
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
  bookings = app.get(HotelBookingsService);
  for (const m of Object.values(db.models)) await m.init();
});

after(async () => {
  if (app) await app.close();
  if (mongo) await mongo.stop();
});

let seq = 0;
async function user(name, status = 'active') {
  const u = await db.model('User').create({
    name,
    email: `rv${++seq}-${Date.now()}@youssef-test.example`,
    passwordHash: 'x',
    status,
  });
  return String(u._id);
}

async function hotelWithRoom() {
  const hotel = await db.model('Hotel').create({
    name: `H${Math.random()}`,
    address: 'Nile St',
    cityId: 'cairo',
    countryCode: 'EG',
    starClass: 4,
    currency: 'EGP',
  });
  const room = await db.model('Room').create({
    hotelId: hotel._id,
    roomNumber: '101',
    type: 'Double',
    beds: 1,
    maxOccupancy: 2,
    pricePerNight: 1000,
  });
  await db.model('RoomAvailability').create({
    roomId: room._id,
    startDate: day(0),
    endDate: day(300),
    kind: 'Available',
  });
  return { hotel, room };
}

/** A real reservation (Hashad's service), then moved to the wanted state for the test. */
let slot = 0;
async function stay(userId, { hotel, room }, state) {
  const from = 1 + (slot += 3);
  const b = await bookings.create(
    {
      hotelId: String(hotel._id),
      checkInDate: iso(from),
      checkOutDate: iso(from + 2),
      rooms: [{ roomId: String(room._id), adults: 1, childrenAges: [] }],
    },
    userId,
  );
  const past = {
    checkInDate: new Date(Date.now() - 5 * DAY),
    checkOutDate: new Date(Date.now() - 2 * DAY),
  };
  const update =
    state === 'completed'
      ? { status: 'Completed', ...past }
      : state === 'checked-out'
        ? { status: 'Confirmed', ...past } // check-out passed, job not run yet
        : { status: 'Confirmed' }; // upcoming stay
  await db.model('HotelBooking').updateOne({ _id: b._id }, update);
  return String(b._id);
}

const as = (u) => ({ 'x-test-user': u });
const review = (bookingId, u, body) =>
  request(http)
    .post(`/api/hotel-bookings/${bookingId}/review`)
    .set(as(u))
    .send(body);

test('review a completed stay once; validation and ownership (HTL-23)', async () => {
  const sara = await user('Sara');
  const h = await hotelWithRoom();
  const done = await stay(sara, h, 'completed');
  const upcoming = await stay(sara, h, 'upcoming');
  const checkedOut = await stay(sara, h, 'checked-out');

  assert.equal(
    (await review(upcoming, sara, { rating: 5 })).body.code,
    'STAY_NOT_COMPLETED',
  );
  assert.equal(
    (await review(done, await user('Other'), { rating: 5 })).body.code,
    'NOT_RESOURCE_OWNER',
  );
  assert.equal(
    (await review(done, sara, { rating: 6 })).body.code,
    'VALIDATION_FAILED',
  );
  assert.equal(
    (await review(done, sara, { rating: 4.5 })).body.code,
    'VALIDATION_FAILED',
  );
  assert.equal(
    (await review(done, sara, { rating: 4, comment: 'x'.repeat(1001) })).body
      .code,
    'VALIDATION_FAILED',
  );

  const ok = await review(done, sara, { rating: 4, comment: 'Lovely' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.author.name, 'Sara');
  assert.equal(
    (await review(done, sara, { rating: 5 })).body.code,
    'REVIEW_ALREADY_EXISTS',
  );
  // check-out date passed but the status job has not run yet: still allowed
  assert.equal((await review(checkedOut, sara, { rating: 2 })).status, 201);
});

test('average rating recalculated on create, edit and delete; public list newest first (HTL-23, HTL-24, ACC-12)', async () => {
  const sara = await user('Sara');
  const omar = await user('Omar');
  const h = await hotelWithRoom();
  const r1 = (
    await review(await stay(sara, h, 'completed'), sara, {
      rating: 4,
      comment: 'Good',
    })
  ).body;
  const r2 = (
    await review(await stay(omar, h, 'completed'), omar, {
      rating: 5,
      comment: 'Great',
    })
  ).body;

  const hotelOf = async () => db.model('Hotel').findById(h.hotel._id).lean();
  assert.deepEqual(
    [(await hotelOf()).averageRating, (await hotelOf()).ratingCount],
    [4.5, 2],
  );

  const list = await request(http).get(`/api/hotels/${h.hotel._id}/reviews`); // guest
  assert.equal(list.status, 200);
  assert.equal(list.body.averageRating, 4.5);
  assert.equal(list.body.ratingCount, 2);
  assert.deepEqual(
    list.body.items.map((r) => r.comment),
    ['Great', 'Good'],
  );

  const edited = await request(http)
    .patch(`/api/reviews/${r2.id}`)
    .set(as(omar))
    .send({ rating: 1 });
  assert.equal(edited.body.rating, 1);
  assert.equal((await hotelOf()).averageRating, 2.5);
  assert.equal(
    (
      await request(http)
        .patch(`/api/reviews/${r2.id}`)
        .set(as(sara))
        .send({ rating: 5 })
    ).body.code,
    'NOT_RESOURCE_OWNER',
  );

  // ACC-12: deactivated author shown as "Deleted user"
  await db.model('User').updateOne({ _id: omar }, { status: 'deactivated' });
  const names = (
    await request(http).get(`/api/hotels/${h.hotel._id}/reviews`)
  ).body.items.map((r) => r.author.name);
  assert.deepEqual(names, ['Deleted user', 'Sara']);

  assert.equal(
    (await request(http).delete(`/api/reviews/${r1.id}`).set(as(sara))).status,
    204,
  );
  assert.deepEqual(
    [(await hotelOf()).averageRating, (await hotelOf()).ratingCount],
    [1, 1],
  );
  assert.equal(
    (await request(http).delete(`/api/reviews/${r2.id}`).set(as(omar))).status,
    204,
  );
  assert.deepEqual(
    [(await hotelOf()).averageRating, (await hotelOf()).ratingCount],
    [null, 0],
  );
  assert.equal(
    (await request(http).get(`/api/hotels/${new Types.ObjectId()}/reviews`))
      .status,
    404,
  );
});

test('the hotel moderator replies to a review (HTL-26)', async () => {
  const sara = await user('Sara');
  const h = await hotelWithRoom();
  const other = await hotelWithRoom();
  const r = (
    await review(await stay(sara, h, 'completed'), sara, {
      rating: 4,
      comment: 'Nice',
    })
  ).body;
  const mod = await user('Hotel Mod');
  const otherMod = await user('Other Mod');
  await db
    .model('User')
    .updateMany({ _id: { $in: [mod, otherMod] } }, { role: 'hotel_moderator' });
  await db.model('ModeratorAssignment').create([
    { moderatorId: mod, providerType: 'hotel', providerId: h.hotel._id },
    {
      moderatorId: otherMod,
      providerType: 'hotel',
      providerId: other.hotel._id,
    },
  ]);
  const asMod = (u) => ({ 'x-test-user': u, 'x-test-role': 'hotel_moderator' });

  const ok = await request(http)
    .post(`/api/reviews/${r.id}/reply`)
    .set(asMod(mod))
    .send({ body: 'Thank you!' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.reply.body, 'Thank you!');
  assert.equal(
    (
      await request(http)
        .post(`/api/reviews/${r.id}/reply`)
        .set(asMod(otherMod))
        .send({ body: 'x' })
    ).body.code,
    'NOT_ASSIGNED_PROVIDER',
  );
  assert.equal(
    (
      await request(http)
        .post(`/api/reviews/${r.id}/reply`)
        .set(as(sara))
        .send({ body: 'x' })
    ).body.code,
    'INSUFFICIENT_ROLE',
  );
  assert.equal(
    (
      await request(http)
        .post(`/api/reviews/${r.id}/reply`)
        .set(asMod(mod))
        .send({ body: '  ' })
    ).body.code,
    'VALIDATION_FAILED',
  );

  await request(http)
    .post(`/api/reviews/${r.id}/reply`)
    .set(asMod(mod))
    .send({ body: 'Hope to see you again' });
  const listed = (await request(http).get(`/api/hotels/${h.hotel._id}/reviews`))
    .body.items[0];
  assert.equal(
    listed.reply.body,
    'Hope to see you again',
    'replying again replaces it',
  );
});

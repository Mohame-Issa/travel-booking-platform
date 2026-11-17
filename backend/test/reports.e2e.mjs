// Reports (GEN-09) and admin moderation (GEN-10), taken over from Omar Rashed's
// part, on the real itinerary, review, hotel and audit modules, against a
// disposable local replica set. Never loads .env or touches the shared database.
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
import { AuditModule } from '../dist/audit/audit.module.js';
import { AllExceptionsFilter } from '../dist/common/filters/all-exceptions.filter.js';
import { RolesGuard } from '../dist/common/guards/roles.guard.js';
import { createValidationPipe } from '../dist/common/pipes/validation.pipe.js';
import {
  FLIGHT_BOOKING_HISTORY_READER,
  PendingFlightBookingHistoryReader,
} from '../dist/flights/flight-booking-history.interface.js';
import { HotelBookingsModule } from '../dist/hotel-bookings/hotel-bookings.module.js';
import { HotelsCatalogueModule } from '../dist/hotels/hotels-catalogue.module.js';
import { NotificationsModule } from '../dist/notifications/notifications.module.js';
import { ReportsModule } from '../dist/reports/reports.module.js';
import { UploadsModule } from '../dist/uploads/uploads.module.js';
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
        role: req.headers['x-test-role'] ?? 'user',
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

let mongo, app, db, http;

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
          () => ({ UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'rp-uploads-')) }),
        ],
      }),
      MongooseModule.forRoot(mongo.getUri('report_tests')),
      UsersModule,
      AuditModule,
      NotificationsModule,
      UploadsModule,
      HotelsCatalogueModule,
      HotelBookingsModule,
      HistoryReaderStub,
      ReportsModule,
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
  for (const m of Object.values(db.models)) await m.init();
  await db
    .model('Country')
    .create({ _id: 'EG', code: 'EG', name: 'Egypt', currency: 'EGP' });
  await db
    .model('City')
    .create({
      _id: 'cairo',
      cityId: 'cairo',
      name: 'Cairo',
      countryCode: 'EG',
    });
});

after(async () => {
  if (app) await app.close();
  if (mongo) await mongo.stop();
});

const id = () => String(new Types.ObjectId());
const ADMIN = id();
const asUser = (u) => ({ 'x-test-user': u });
const asAdmin = { 'x-test-user': ADMIN, 'x-test-role': 'admin' };
const report = (u, targetType, targetId, reason = 'Spam') =>
  request(http)
    .post('/api/reports')
    .set(asUser(u))
    .send({ targetType, targetId, reason });

async function publicItinerary(owner, title = `Trip ${Math.random()}`) {
  const it = await db
    .model('Itinerary')
    .create({
      userId: owner,
      title,
      countries: ['EG'],
      startDate: new Date('2026-12-01T00:00:00Z'),
      visibility: 'public',
    });
  await db
    .model('ItineraryDay')
    .create({
      itineraryId: it._id,
      userId: owner,
      dayNumber: 1,
      cityId: 'cairo',
    });
  await db.model('Itinerary').updateOne({ _id: it._id }, { dayCount: 1 });
  return String(it._id);
}
async function hotelWithReviews(...ratings) {
  const hotel = await db
    .model('Hotel')
    .create({
      name: `H${Math.random()}`,
      address: 'Nile St',
      cityId: 'cairo',
      countryCode: 'EG',
      starClass: 4,
      currency: 'EGP',
    });
  const reviews = [];
  for (const rating of ratings) {
    const r = await db
      .model('Review')
      .create({
        userId: id(),
        hotelId: hotel._id,
        bookingId: new Types.ObjectId(),
        rating,
        comment: `stars ${rating}`,
      });
    reviews.push(String(r._id));
  }
  const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  await db
    .model('Hotel')
    .updateOne(
      { _id: hotel._id },
      { averageRating: avg, ratingCount: ratings.length },
    );
  return { hotelId: String(hotel._id), reviews };
}
const hotelRating = async (hotelId) => {
  const h = await db.model('Hotel').findById(hotelId).lean();
  return [h.averageRating, h.ratingCount];
};

test('report content once, with a reason, only what you can see (GEN-09)', async () => {
  const owner = id();
  const reporter = id();
  const itinerary = await publicItinerary(owner);
  const res = await report(
    reporter,
    'itinerary',
    itinerary,
    'Copied from my blog',
  );
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, 'open');
  assert.equal(res.body.target.exists, true);
  assert.equal(
    (await report(reporter, 'itinerary', itinerary)).body.code,
    'ALREADY_REPORTED',
  );
  assert.equal(
    (await report(id(), 'itinerary', itinerary)).status,
    201,
    'another user may report it too',
  );
  assert.equal(
    (await report(reporter, 'itinerary', itinerary, '   ')).body.code,
    'VALIDATION_FAILED',
  );
  assert.equal(
    (await report(reporter, 'post', itinerary)).body.code,
    'VALIDATION_FAILED',
    'blog was dropped',
  );

  const priv = await db
    .model('Itinerary')
    .create({
      userId: owner,
      title: 'Private',
      countries: ['EG'],
      startDate: new Date(),
      visibility: 'private',
    });
  assert.equal(
    (await report(reporter, 'itinerary', String(priv._id))).status,
    404,
  );
  assert.equal((await report(reporter, 'review', id())).status, 404);

  // admin only
  assert.equal(
    (await request(http).get('/api/admin/reports').set(asUser(reporter))).body
      .code,
    'INSUFFICIENT_ROLE',
  );
  const list = await request(http).get('/api/admin/reports').set(asAdmin);
  assert.equal(list.status, 200);
  assert.ok(
    list.body.items.some((r) => r.target.id === itinerary && r.target.preview),
  );
});

test('hide from a report: gone from public search, still visible to the owner; all its reports resolved; audited (GEN-10)', async () => {
  const owner = id();
  const tag = `Hide${Date.now()}`;
  const itinerary = await publicItinerary(owner, `Nile ${tag}`);
  const r1 = (await report(id(), 'itinerary', itinerary)).body;
  const r2 = (await report(id(), 'itinerary', itinerary)).body;
  assert.equal(
    (await request(http).get(`/api/itineraries/public/search?q=${tag}`)).body
      .items.length,
    1,
  );

  const res = await request(http)
    .patch(`/api/admin/reports/${r1.id}`)
    .set(asAdmin)
    .send({ action: 'hide' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'content_hidden');
  assert.equal(res.body.target.hidden, true);
  assert.equal(
    (await db.model('Report').findById(r2.id).lean()).status,
    'content_hidden',
    'other report on same content resolved',
  );

  assert.equal(
    (await request(http).get(`/api/itineraries/public/search?q=${tag}`)).body
      .items.length,
    0,
  );
  assert.equal(
    (await request(http).get(`/api/itineraries/public/${itinerary}`)).status,
    404,
  );
  assert.equal(
    (
      await request(http)
        .get(`/api/itineraries/${itinerary}`)
        .set(asUser(owner))
    ).status,
    200,
    'author still sees it',
  );
  assert.equal(
    (
      await request(http)
        .patch(`/api/admin/reports/${r1.id}`)
        .set(asAdmin)
        .send({ action: 'dismiss' })
    ).body.code,
    'REPORT_ALREADY_RESOLVED',
  );
  assert.equal(
    await db
      .model('AuditLog')
      .countDocuments({
        action: 'itinerary.hidden',
        targetId: itinerary,
        actorId: ADMIN,
      }),
    1,
  );

  // unhide directly
  assert.equal(
    (
      await request(http)
        .patch(`/api/admin/content/itinerary/${itinerary}`)
        .set(asAdmin)
        .send({ hidden: false })
    ).status,
    204,
  );
  assert.equal(
    (await request(http).get(`/api/itineraries/public/search?q=${tag}`)).body
      .items.length,
    1,
  );
});

test('dismiss keeps the content; delete removes a review and recalculates the hotel rating (GEN-10, HTL-23)', async () => {
  const { hotelId, reviews } = await hotelWithReviews(5, 1);
  const kept = (await report(id(), 'review', reviews[0], 'I disagree')).body;
  const dismissed = await request(http)
    .patch(`/api/admin/reports/${kept.id}`)
    .set(asAdmin)
    .send({ action: 'dismiss' });
  assert.equal(dismissed.body.status, 'dismissed');
  assert.ok(await db.model('Review').exists({ _id: reviews[0] }));

  const bad = (await report(id(), 'review', reviews[1], 'Insults')).body;
  const deleted = await request(http)
    .patch(`/api/admin/reports/${bad.id}`)
    .set(asAdmin)
    .send({ action: 'delete' });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal(deleted.body.status, 'content_deleted');
  assert.equal(deleted.body.target.exists, false);
  assert.equal(await db.model('Review').exists({ _id: reviews[1] }), null);
  assert.deepEqual(await hotelRating(hotelId), [5, 1]);
  assert.equal(
    (
      await request(http)
        .patch(`/api/admin/reports/${bad.id}`)
        .set(asAdmin)
        .send({ action: 'shout' })
    ).body.code,
    'VALIDATION_FAILED',
  );
});

test('hide / delete directly; a hidden review stops counting in the rating (GEN-10)', async () => {
  const { hotelId, reviews } = await hotelWithReviews(4, 2);
  const hide = await request(http)
    .patch(`/api/admin/content/review/${reviews[1]}`)
    .set(asAdmin)
    .send({ hidden: true });
  assert.equal(hide.status, 204);
  assert.deepEqual(await hotelRating(hotelId), [4, 1]);
  const list = (await request(http).get(`/api/hotels/${hotelId}/reviews`)).body;
  assert.deepEqual(
    list.items.map((r) => r.rating),
    [4],
  );
  await request(http)
    .patch(`/api/admin/content/review/${reviews[1]}`)
    .set(asAdmin)
    .send({ hidden: false });
  assert.deepEqual(await hotelRating(hotelId), [3, 2]);

  const itinerary = await publicItinerary(id());
  assert.equal(
    (
      await request(http)
        .delete(`/api/admin/content/itinerary/${itinerary}`)
        .set(asAdmin)
    ).status,
    204,
  );
  assert.equal(await db.model('Itinerary').exists({ _id: itinerary }), null);
  assert.equal(
    await db.model('ItineraryDay').countDocuments({ itineraryId: itinerary }),
    0,
  );
  assert.equal(
    (
      await request(http)
        .delete(`/api/admin/content/itinerary/${itinerary}`)
        .set(asAdmin)
    ).status,
    404,
  );
  assert.equal(
    (
      await request(http)
        .delete(`/api/admin/content/itinerary/${id()}`)
        .set(asUser(id()))
    ).body.code,
    'INSUFFICIENT_ROLE',
  );
  assert.equal(
    (await request(http).delete(`/api/admin/content/post/${id()}`).set(asAdmin))
      .body.code,
    'VALIDATION_FAILED',
  );
});

// Itineraries (ITN-01..ITN-26, taken over from Nada Gad's part) against a
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
import { AllExceptionsFilter } from '../dist/common/filters/all-exceptions.filter.js';
import { RolesGuard } from '../dist/common/guards/roles.guard.js';
import { createValidationPipe } from '../dist/common/pipes/validation.pipe.js';
import {
  FLIGHT_BOOKING_HISTORY_READER,
  PendingFlightBookingHistoryReader,
} from '../dist/flights/flight-booking-history.interface.js';
import {
  FLIGHT_BOOKING_PAYMENT_READER,
  HOTEL_BOOKING_PAYMENT_READER,
} from '../dist/common/interfaces/index.js';
import { ExchangeRatesService } from '../dist/itineraries/exchange-rates.service.js';
import { ItinerariesModule } from '../dist/itineraries/itineraries.module.js';
import { UploadsModule } from '../dist/uploads/uploads.module.js';
import { UploadsService } from '../dist/uploads/uploads.service.js';
import { UsersModule } from '../dist/users/users.module.js';

const newUser = () => String(new Types.ObjectId());

/** Stands in for the cookie AuthGuard: the caller is chosen with x-test-user. */
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

// Yassin's FlightsModule needs Omar's booking-history reader; the catalogue's
// own "pending" stand-in is enough for searching.
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

// Booking readers (Omar Hashem / Mohamed Hashad) backed by a table the tests fill (ITN-27).
const fakeBookings = new Map(); // bookingId -> snapshot
const fakeReader = {
  getPaymentSnapshot: async (id) => fakeBookings.get(String(id)) ?? null,
};
class BookingReaderStub {}
Module({
  providers: [
    { provide: FLIGHT_BOOKING_PAYMENT_READER, useValue: fakeReader },
    { provide: HOTEL_BOOKING_PAYMENT_READER, useValue: fakeReader },
  ],
  exports: [FLIGHT_BOOKING_PAYMENT_READER, HOTEL_BOOKING_PAYMENT_READER],
})(BookingReaderStub);
Global()(BookingReaderStub);

let mongo, app, db, http, uploads, fx;

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
          () => ({ UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'itn-uploads-')) }),
        ],
      }),
      MongooseModule.forRoot(mongo.getUri('itinerary_tests')),
      UsersModule,
      UploadsModule,
      HistoryReaderStub,
      BookingReaderStub,
      ItinerariesModule,
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
  fx = app.get(ExchangeRatesService);
  for (const m of Object.values(db.models)) await m.init();
  // Reference data the itinerary rules rely on (GEN-12): same ids as Countries.csv / Cities.csv.
  await db.model('Country').create([
    { _id: 'EG', code: 'EG', name: 'Egypt', currency: 'EGP' },
    { _id: 'AE', code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
  ]);
  await db.model('City').create([
    { _id: 'cairo', cityId: 'cairo', name: 'Cairo', countryCode: 'EG' },
    { _id: 'dubai', cityId: 'dubai', name: 'Dubai', countryCode: 'AE' },
    { _id: 'luxor', cityId: 'luxor', name: 'Luxor', countryCode: 'EG' },
  ]);
  await db.model('Airport').create([
    {
      _id: 'CAI',
      iataCode: 'CAI',
      name: 'Cairo International Airport',
      cityId: 'cairo',
      countryCode: 'EG',
      timeZone: 'Africa/Cairo',
    },
    {
      _id: 'DXB',
      iataCode: 'DXB',
      name: 'Dubai International Airport',
      cityId: 'dubai',
      countryCode: 'AE',
      timeZone: 'Asia/Dubai',
    },
  ]);
});

after(async () => {
  if (app) await app.close();
  if (mongo) await mongo.stop();
});

const as = (userId) => ({ 'x-test-user': userId });
const api = {
  get: (path, userId) => request(http).get(`/api${path}`).set(as(userId)),
  post: (path, userId, body) =>
    request(http)
      .post(`/api${path}`)
      .set(as(userId))
      .send(body ?? {}),
  patch: (path, userId, body) =>
    request(http)
      .patch(`/api${path}`)
      .set(as(userId))
      .send(body ?? {}),
  del: (path, userId) => request(http).delete(`/api${path}`).set(as(userId)),
};

async function createItinerary(userId, body = {}) {
  const res = await api.post('/itineraries', userId, {
    title: 'Two weeks in Egypt',
    countries: ['EG'],
    startDate: '2026-12-01',
    ...body,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

test('create: private by default, countries from the list, validation (ITN-01)', async () => {
  const owner = newUser();
  const it = await createItinerary(owner, { countries: ['eg', 'ae'] });
  assert.equal(it.visibility, 'private');
  assert.deepEqual(it.countries, ['EG', 'AE']);
  assert.equal(it.startDate, '2026-12-01');
  assert.equal(it.dayCount, 0);
  assert.equal(it.endDate, null);

  const unknown = await api.post('/itineraries', owner, {
    title: 'x',
    countries: ['ZZ'],
    startDate: '2026-12-01',
  });
  assert.equal(unknown.body.code, 'UNKNOWN_COUNTRY');
  const longTitle = await api.post('/itineraries', owner, {
    title: 'a'.repeat(101),
    countries: ['EG'],
    startDate: '2026-12-01',
  });
  assert.equal(longTitle.body.code, 'VALIDATION_FAILED');
  const noCountry = await api.post('/itineraries', owner, {
    title: 'x',
    countries: [],
    startDate: '2026-12-01',
  });
  assert.equal(noCountry.body.code, 'VALIDATION_FAILED');
  const badDate = await api.post('/itineraries', owner, {
    title: 'x',
    countries: ['EG'],
    startDate: '2026-02-30',
  });
  assert.equal(badDate.body.code, 'VALIDATION_FAILED');
  // registered users only
  const admin = await request(http)
    .post('/api/itineraries')
    .set({ 'x-test-user': owner, 'x-test-role': 'admin' })
    .send({ title: 'x', countries: ['EG'], startDate: '2026-12-01' });
  assert.equal(admin.body.code, 'INSUFFICIENT_ROLE');
});

test('list: only mine, most recently updated first, paginated (ITN-03, GEN-05)', async () => {
  const owner = newUser();
  const other = newUser();
  const ids = [];
  for (let i = 0; i < 12; i++)
    ids.push((await createItinerary(owner, { title: `Trip ${i}` })).id);
  await createItinerary(other);
  // touching the first one makes it the most recently updated
  await api.patch(`/itineraries/${ids[0]}`, owner, { title: 'Trip 0 renamed' });

  const page1 = await api.get('/itineraries', owner);
  assert.equal(page1.status, 200);
  assert.equal(page1.body.meta.totalItems, 12);
  assert.equal(page1.body.items.length, 10);
  assert.equal(page1.body.items[0].id, ids[0]);
  assert.equal(page1.body.items[1].id, ids[11]);
  const page2 = await api.get('/itineraries?page=2', owner);
  assert.equal(page2.body.items.length, 2);
});

test('owner only: others get 403, unknown ids 404 (ACC-11)', async () => {
  const owner = newUser();
  const it = await createItinerary(owner);
  assert.equal((await api.get(`/itineraries/${it.id}`, owner)).status, 200);
  assert.equal(
    (await api.get(`/itineraries/${it.id}`, newUser())).body.code,
    'NOT_RESOURCE_OWNER',
  );
  assert.equal(
    (await api.patch(`/itineraries/${it.id}`, newUser(), { title: 'hack' }))
      .body.code,
    'NOT_RESOURCE_OWNER',
  );
  assert.equal(
    (await api.del(`/itineraries/${it.id}`, newUser())).body.code,
    'NOT_RESOURCE_OWNER',
  );
  assert.equal(
    (await api.get(`/itineraries/${new Types.ObjectId()}`, owner)).status,
    404,
  );
  assert.equal(
    (await api.get('/itineraries/abc', owner)).body.code,
    'INVALID_ID',
  );
});

test('edit and visibility; day dates follow the start date (ITN-01, ITN-05, ITN-20)', async () => {
  const owner = newUser();
  const it = await createItinerary(owner);
  // two days inserted directly (day endpoints come in the next step)
  await db.model('ItineraryDay').create([
    { itineraryId: it.id, userId: owner, dayNumber: 1, cityId: 'cairo' },
    { itineraryId: it.id, userId: owner, dayNumber: 2, cityId: 'cairo' },
  ]);
  await db.model('Itinerary').updateOne({ _id: it.id }, { dayCount: 2 });

  const pub = await api.patch(`/itineraries/${it.id}`, owner, {
    visibility: 'public',
    startDate: '2026-12-30',
  });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.visibility, 'public');
  assert.equal(pub.body.endDate, '2026-12-31');

  const detail = (await api.get(`/itineraries/${it.id}`, owner)).body;
  assert.deepEqual(
    detail.days.map((d) => d.date),
    ['2026-12-30', '2026-12-31'],
  );

  assert.equal(
    (await api.patch(`/itineraries/${it.id}`, owner, { visibility: 'private' }))
      .body.visibility,
    'private',
  );
  assert.equal(
    (await api.patch(`/itineraries/${it.id}`, owner, { visibility: 'secret' }))
      .body.code,
    'VALIDATION_FAILED',
  );
  assert.equal(
    (await api.patch(`/itineraries/${it.id}`, owner, { countries: ['ZZ'] }))
      .body.code,
    'UNKNOWN_COUNTRY',
  );
  assert.equal(
    (await api.patch(`/itineraries/${it.id}`, owner, { userId: newUser() }))
      .body.code,
    'VALIDATION_FAILED',
  );
});

test('delete removes days, activities, budgets and transport; other itineraries untouched (ITN-01)', async () => {
  const owner = newUser();
  const it = await createItinerary(owner);
  const keep = await createItinerary(owner, { title: 'Keep me' });
  for (const target of [it.id, keep.id]) {
    const day = await db.model('ItineraryDay').create({
      itineraryId: target,
      userId: owner,
      dayNumber: 1,
      cityId: 'cairo',
    });
    await db.model('Activity').create({
      itineraryId: target,
      dayId: day._id,
      userId: owner,
      name: 'Pyramids',
    });
    await db.model('BudgetEntry').create({
      itineraryId: target,
      dayId: day._id,
      userId: owner,
      category: 'food',
      amount: 100,
      currency: 'EGP',
    });
    await db.model('TransportCost').create({
      itineraryId: target,
      dayId: day._id,
      userId: owner,
      mode: 'train',
      fromCityId: 'cairo',
      toCityId: 'cairo',
      amount: 50,
      currency: 'EGP',
    });
  }

  assert.equal((await api.del(`/itineraries/${it.id}`, owner)).status, 204);
  for (const model of [
    'ItineraryDay',
    'Activity',
    'BudgetEntry',
    'TransportCost',
  ]) {
    assert.equal(
      await db.model(model).countDocuments({ itineraryId: it.id }),
      0,
      model,
    );
    assert.equal(
      await db.model(model).countDocuments({ itineraryId: keep.id }),
      1,
      model,
    );
  }
  assert.equal((await api.get(`/itineraries/${it.id}`, owner)).status, 404);
  assert.equal((await api.get(`/itineraries/${keep.id}`, owner)).status, 200);
});

// ------------------------------------------------------------------ step 2
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const upload = async (userId) =>
  (await uploads.store({ buffer: PNG, size: PNG.length }, userId)).id;

async function withDays(owner, ...cities) {
  const it = await createItinerary(owner);
  let detail;
  for (const cityId of cities) {
    const res = await api.post(`/itineraries/${it.id}/days`, owner, { cityId });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    detail = res.body;
  }
  return detail ?? (await api.get(`/itineraries/${it.id}`, owner)).body;
}
const summary = (detail) =>
  detail.days.map((d) => `${d.dayNumber}:${d.cityId}:${d.date}`);

test('add days: sequential numbers, derived dates, city list, groups (ITN-05, ITN-09)', async () => {
  const owner = newUser();
  const detail = await withDays(owner, 'cairo', 'cairo', 'luxor');
  assert.deepEqual(summary(detail), [
    '1:cairo:2026-12-01',
    '2:cairo:2026-12-02',
    '3:luxor:2026-12-03',
  ]);
  assert.equal(detail.dayCount, 3);
  assert.equal(detail.endDate, '2026-12-03');
  assert.deepEqual(
    detail.groups.map((g) => [g.cityId, g.dayCount, g.startDate, g.endDate]),
    [
      ['cairo', 2, '2026-12-01', '2026-12-02'],
      ['luxor', 1, '2026-12-03', '2026-12-03'],
    ],
  );
  const bad = await api.post(`/itineraries/${detail.id}/days`, owner, {
    cityId: 'atlantis',
  });
  assert.equal(bad.body.code, 'UNKNOWN_CITY');
  const noCity = await api.post(`/itineraries/${detail.id}/days`, owner, {});
  assert.equal(noCity.body.code, 'VALIDATION_FAILED');
  assert.equal(
    (
      await api.post(`/itineraries/${detail.id}/days`, newUser(), {
        cityId: 'cairo',
      })
    ).body.code,
    'NOT_RESOURCE_OWNER',
  );
});

test('at most 60 days, and parallel adds never duplicate a number (ITN-05)', async () => {
  const owner = newUser();
  const it = await createItinerary(owner);
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      api.post(`/itineraries/${it.id}/days`, owner, { cityId: 'cairo' }),
    ),
  );
  assert.ok(results.every((r) => r.status === 201));
  const numbers = (
    await db.model('ItineraryDay').find({ itineraryId: it.id }).lean()
  )
    .map((d) => d.dayNumber)
    .sort((a, b) => a - b);
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6]);

  await db.model('Itinerary').updateOne({ _id: it.id }, { dayCount: 60 });
  const full = await api.post(`/itineraries/${it.id}/days`, owner, {
    cityId: 'cairo',
  });
  assert.equal(full.body.code, 'ITINERARY_DAY_LIMIT');
});

test('edit a day; a day of another itinerary is 404 (ITN-05)', async () => {
  const owner = newUser();
  const detail = await withDays(owner, 'cairo');
  const other = await withDays(owner, 'dubai');
  const dayId = detail.days[0].id;
  const edited = await api.patch(
    `/itineraries/${detail.id}/days/${dayId}`,
    owner,
    { cityId: 'luxor', notes: 'Temples' },
  );
  assert.equal(edited.status, 200);
  assert.equal(edited.body.days[0].cityId, 'luxor');
  assert.equal(edited.body.days[0].notes, 'Temples');
  assert.equal(
    (
      await api.patch(
        `/itineraries/${detail.id}/days/${other.days[0].id}`,
        owner,
        { notes: 'x' },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await api.patch(`/itineraries/${detail.id}/days/${dayId}`, newUser(), {
        notes: 'x',
      })
    ).body.code,
    'NOT_RESOURCE_OWNER',
  );
});

test('delete a day: its activities go, later days renumbered and dates move back (ITN-07)', async () => {
  const owner = newUser();
  const detail = await withDays(owner, 'cairo', 'luxor', 'dubai');
  const luxor = detail.days[1].id;
  await api.post(`/itineraries/${detail.id}/days/${luxor}/activities`, owner, {
    name: 'Karnak',
  });
  await db.model('BudgetEntry').create({
    itineraryId: detail.id,
    dayId: luxor,
    userId: owner,
    category: 'food',
    amount: 10,
    currency: 'EGP',
  });

  const after = await api.del(`/itineraries/${detail.id}/days/${luxor}`, owner);
  assert.equal(after.status, 200);
  assert.deepEqual(summary(after.body), [
    '1:cairo:2026-12-01',
    '2:dubai:2026-12-02',
  ]);
  assert.equal(after.body.dayCount, 2);
  assert.equal(await db.model('Activity').countDocuments({ dayId: luxor }), 0);
  assert.equal(
    await db.model('BudgetEntry').countDocuments({ dayId: luxor }),
    0,
  );
  assert.equal(
    (await api.del(`/itineraries/${detail.id}/days/${luxor}`, owner)).status,
    404,
  );
});

test('reorder: move a day, renumber, dates and groups follow, activities stay with their day (ITN-08)', async () => {
  const owner = newUser();
  const detail = await withDays(owner, 'cairo', 'cairo', 'luxor');
  const luxor = detail.days[2].id;
  await api.post(`/itineraries/${detail.id}/days/${luxor}/activities`, owner, {
    name: 'Valley of the Kings',
  });

  const moved = await api.patch(
    `/itineraries/${detail.id}/days/reorder`,
    owner,
    { dayId: luxor, position: 1 },
  );
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.deepEqual(summary(moved.body), [
    '1:luxor:2026-12-01',
    '2:cairo:2026-12-02',
    '3:cairo:2026-12-03',
  ]);
  assert.equal(moved.body.days[0].activities[0].name, 'Valley of the Kings');
  assert.deepEqual(
    moved.body.groups.map((g) => [g.cityId, g.dayCount]),
    [
      ['luxor', 1],
      ['cairo', 2],
    ],
  );

  const tooFar = await api.patch(
    `/itineraries/${detail.id}/days/reorder`,
    owner,
    { dayId: luxor, position: 4 },
  );
  assert.equal(tooFar.body.code, 'VALIDATION_FAILED');
  assert.equal(
    (
      await api.patch(`/itineraries/${detail.id}/days/reorder`, newUser(), {
        dayId: luxor,
        position: 2,
      })
    ).body.code,
    'NOT_RESOURCE_OWNER',
  );
});

test('activities: create, order by time, edit, clear, delete, owner only (ITN-10)', async () => {
  const owner = newUser();
  const detail = await withDays(owner, 'cairo');
  const dayUrl = `/itineraries/${detail.id}/days/${detail.days[0].id}/activities`;
  const late = (
    await api.post(dayUrl, owner, {
      name: 'Dinner cruise',
      time: '20:00',
      cost: 900,
      currency: 'egp',
    })
  ).body;
  const early = (
    await api.post(dayUrl, owner, { name: 'Pyramids', time: '08:30' })
  ).body;
  const loose = (await api.post(dayUrl, owner, { name: 'Shopping' })).body;
  assert.equal(late.currency, 'EGP');
  assert.equal(
    (await api.post(dayUrl, owner, { name: 'x', cost: 10 })).body.code,
    'VALIDATION_FAILED',
  );
  assert.equal(
    (await api.post(dayUrl, owner, { name: 'x', cost: -1, currency: 'EGP' }))
      .body.code,
    'VALIDATION_FAILED',
  );
  assert.equal(
    (await api.post(dayUrl, owner, { name: 'x', time: '25:00' })).body.code,
    'VALIDATION_FAILED',
  );

  const names = (
    await api.get(`/itineraries/${detail.id}`, owner)
  ).body.days[0].activities.map((a) => a.name);
  assert.deepEqual(names, ['Pyramids', 'Dinner cruise', 'Shopping']);

  const edited = await api.patch(`/activities/${late.id}`, owner, {
    time: null,
    cost: null,
    currency: null,
    description: 'Nile',
  });
  assert.equal(edited.status, 200);
  assert.deepEqual(
    [
      edited.body.time,
      edited.body.cost,
      edited.body.currency,
      edited.body.description,
    ],
    [null, null, null, 'Nile'],
  );
  assert.equal(
    (await api.patch(`/activities/${early.id}`, owner, { cost: 5 })).body.code,
    'VALIDATION_FAILED',
  );
  assert.equal(
    (await api.patch(`/activities/${early.id}`, newUser(), { name: 'hack' }))
      .body.code,
    'NOT_RESOURCE_OWNER',
  );
  assert.equal(
    (await api.del(`/activities/${loose.id}`, newUser())).body.code,
    'NOT_RESOURCE_OWNER',
  );
  assert.equal((await api.del(`/activities/${loose.id}`, owner)).status, 204);
  assert.equal(
    (await api.patch(`/activities/${loose.id}`, owner, { name: 'x' })).status,
    404,
  );
});

test('activity images through the shared upload service, max 5 (ITN-12, GEN-08)', async () => {
  const owner = newUser();
  const detail = await withDays(owner, 'cairo');
  const act = (
    await api.post(
      `/itineraries/${detail.id}/days/${detail.days[0].id}/activities`,
      owner,
      { name: 'Museum' },
    )
  ).body;

  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(String(await upload(owner)));
  for (let i = 0; i < 5; i++) {
    const res = await api.post(`/activities/${act.id}/images`, owner, {
      imageId: ids[i],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
  const sixth = await api.post(`/activities/${act.id}/images`, owner, {
    imageId: ids[5],
  });
  assert.equal(sixth.body.code, 'IMAGE_LIMIT_REACHED');

  const someoneElses = String(await upload(newUser()));
  assert.equal(
    (
      await api.post(`/activities/${act.id}/images`, owner, {
        imageId: someoneElses,
      })
    ).body.code,
    'NOT_RESOURCE_OWNER',
  );

  const shown = (await api.get(`/itineraries/${detail.id}`, owner)).body.days[0]
    .activities[0].images;
  assert.equal(shown.length, 5);
  assert.match(shown[0].url, /^\/api\/uploads\/files\//);

  const removed = await api.del(
    `/activities/${act.id}/images/${ids[0]}`,
    owner,
  );
  assert.equal(removed.body.images.length, 4);
  // the freed slot can be used again
  assert.equal(
    (await api.post(`/activities/${act.id}/images`, owner, { imageId: ids[5] }))
      .status,
    201,
  );
  assert.equal(
    (
      await api.post(`/activities/${act.id}/images`, newUser(), {
        imageId: ids[0],
      })
    ).body.code,
    'NOT_RESOURCE_OWNER',
  );
});

// ------------------------------------------------------------------ step 3
const RATES = {
  AED: 3.6,
  EGP: 50,
  EUR: 0.9,
  GBP: 0.75,
  JPY: 150,
  SAR: 3.75,
  USD: 1,
};
let fxCalls = 0;
let fxDown = false;
function stubFx() {
  fx.fetchLatest = async () => {
    fxCalls += 1;
    if (fxDown) throw new Error('FXRatesAPI down (test)');
    return { rates: { ...RATES }, rateDate: '2026-11-17' };
  };
}

test('budget entries and transport costs: create, validate, edit, delete, owner only (ITN-14, ITN-16)', async () => {
  const owner = newUser();
  const detail = await withDays(owner, 'cairo', 'luxor');
  const [d1, d2] = detail.days.map((d) => d.id);
  const entryUrl = `/itineraries/${detail.id}/days/${d1}/budgets`;
  const entry = await api.post(entryUrl, owner, {
    category: 'food',
    amount: 450,
    currency: 'egp',
    note: 'Lunch',
  });
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  assert.equal(entry.body.currency, 'EGP');
  assert.equal(
    (
      await api.post(entryUrl, owner, {
        category: 'food',
        amount: -1,
        currency: 'EGP',
      })
    ).body.code,
    'VALIDATION_FAILED',
  );
  assert.equal(
    (
      await api.post(entryUrl, owner, {
        category: 'souvenirs',
        amount: 1,
        currency: 'EGP',
      })
    ).body.code,
    'VALIDATION_FAILED',
  );
  assert.equal(
    (
      await api.post(entryUrl, owner, {
        category: 'food',
        amount: 1,
        currency: 'XYZ',
      })
    ).body.code,
    'VALIDATION_FAILED',
  );
  assert.equal(
    (
      await api.post(entryUrl, newUser(), {
        category: 'food',
        amount: 1,
        currency: 'EGP',
      })
    ).body.code,
    'NOT_RESOURCE_OWNER',
  );

  assert.equal(
    (await api.patch(`/budgets/${entry.body.id}`, owner, { amount: 500 })).body
      .amount,
    500,
  );
  assert.equal(
    (await api.patch(`/budgets/${entry.body.id}`, newUser(), { amount: 1 }))
      .body.code,
    'NOT_RESOURCE_OWNER',
  );

  const tUrl = `/itineraries/${detail.id}/transport-costs`;
  const trip = await api.post(tUrl, owner, {
    dayId: d2,
    mode: 'train',
    fromCityId: 'cairo',
    toCityId: 'luxor',
    amount: 1200,
    currency: 'EGP',
  });
  assert.equal(trip.status, 201, JSON.stringify(trip.body));
  assert.equal(
    (
      await api.post(tUrl, owner, {
        dayId: d2,
        mode: 'train',
        fromCityId: 'cairo',
        toCityId: 'atlantis',
        amount: 1,
        currency: 'EGP',
      })
    ).body.code,
    'UNKNOWN_CITY',
  );
  const otherItinerary = await withDays(owner, 'cairo');
  assert.equal(
    (
      await api.post(tUrl, owner, {
        dayId: otherItinerary.days[0].id,
        mode: 'bus',
        fromCityId: 'cairo',
        toCityId: 'luxor',
        amount: 1,
        currency: 'EGP',
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await api.patch(`/transport-costs/${trip.body.id}`, owner, {
        dayId: d1,
        mode: 'bus',
      })
    ).body.dayId,
    d1,
  );
  assert.equal(
    (
      await api.patch(`/transport-costs/${trip.body.id}`, owner, {
        dayId: otherItinerary.days[0].id,
      })
    ).status,
    404,
  );
  assert.equal(
    (await api.del(`/transport-costs/${trip.body.id}`, newUser())).body.code,
    'NOT_RESOURCE_OWNER',
  );

  const shown = (await api.get(`/itineraries/${detail.id}`, owner)).body
    .days[0];
  assert.equal(shown.budgetEntries[0].amount, 500);
  assert.equal(shown.transportCosts[0].mode, 'bus');
  assert.equal((await api.del(`/budgets/${entry.body.id}`, owner)).status, 204);
  assert.equal(
    (await api.del(`/transport-costs/${trip.body.id}`, owner)).status,
    204,
  );
});

test('budget summary: categories, days, groups; activity costs count as activities (ITN-14, ITN-09)', async () => {
  stubFx();
  const owner = newUser();
  const detail = await withDays(owner, 'cairo', 'cairo', 'luxor');
  const [d1, d2, d3] = detail.days.map((d) => d.id);
  const b = (dayId, category, amount) =>
    api.post(`/itineraries/${detail.id}/days/${dayId}/budgets`, owner, {
      category,
      amount,
      currency: 'EGP',
    });
  await b(d1, 'food', 300);
  await b(d1, 'accommodation', 2000);
  await b(d2, 'in_city_transport', 150);
  await b(d3, 'activities', 100);
  await api.post(`/itineraries/${detail.id}/days/${d3}/activities`, owner, {
    name: 'Karnak',
    cost: 450,
    currency: 'EGP',
  });
  await api.post(`/itineraries/${detail.id}/transport-costs`, owner, {
    dayId: d3,
    mode: 'train',
    fromCityId: 'cairo',
    toCityId: 'luxor',
    amount: 1200,
    currency: 'EGP',
  });

  const before = fxCalls;
  const s = (
    await api.get(
      `/itineraries/${detail.id}/budget-summary?currency=EGP`,
      owner,
    )
  ).body;
  assert.equal(
    fxCalls,
    before,
    'no rates needed when everything is already in EGP',
  );
  assert.equal(s.currency, 'EGP');
  assert.equal(s.rateDate, null);
  assert.deepEqual(s.byCategory, {
    food: 300,
    accommodation: 2000,
    in_city_transport: 150,
    activities: 550,
    intercity_transport: 1200,
  });
  assert.equal(s.total, 4200);
  assert.deepEqual(
    s.byDay.map((d) => [d.dayNumber, d.cityId, d.total]),
    [
      [1, 'cairo', 2300],
      [2, 'cairo', 150],
      [3, 'luxor', 1750],
    ],
  );
  assert.deepEqual(
    s.byGroup.map((g) => [g.cityId, g.dayCount, g.subtotal]),
    [
      ['cairo', 2, 2450],
      ['luxor', 1, 1750],
    ],
  );

  // ITN-07: deleting a day recalculates the totals
  await api.del(`/itineraries/${detail.id}/days/${d1}`, owner);
  const after = (
    await api.get(
      `/itineraries/${detail.id}/budget-summary?currency=EGP`,
      owner,
    )
  ).body;
  assert.equal(after.total, 1900);
  assert.equal(
    (await api.get(`/itineraries/${detail.id}/budget-summary`, newUser())).body
      .code,
    'NOT_RESOURCE_OWNER',
  );
});

test('conversion with daily cached rates, preferred currency, fallback when the API is down (ITN-18)', async () => {
  stubFx();
  fxDown = false;
  await db.model('ExchangeRate').deleteMany({ base: 'USD' }); // only this test's collection on the disposable DB
  const ownerDoc = await db.model('User').create({
    name: 'Fx',
    email: `fx${Date.now()}@youssef-test.example`,
    passwordHash: 'x',
    preferredCurrency: 'USD',
  });
  const owner = String(ownerDoc._id);
  const detail = await withDays(owner, 'cairo');
  const day = detail.days[0].id;
  await api.post(`/itineraries/${detail.id}/days/${day}/budgets`, owner, {
    category: 'food',
    amount: 500,
    currency: 'EGP',
  });
  await api.post(`/itineraries/${detail.id}/days/${day}/budgets`, owner, {
    category: 'food',
    amount: 10,
    currency: 'USD',
  });

  // default = the user's preferred currency (USD): 500 EGP = 10 USD, + 10 USD
  const calls = fxCalls;
  const usd = (await api.get(`/itineraries/${detail.id}/budget-summary`, owner))
    .body;
  assert.equal(usd.currency, 'USD');
  assert.equal(usd.total, 20);
  assert.equal(usd.rateDate, '2026-11-17');
  assert.equal(usd.ratesAreLatest, true);
  assert.equal(fxCalls, calls + 1);

  // same day again: served from the cache, no second API call ("once per day")
  const egp = (
    await api.get(
      `/itineraries/${detail.id}/budget-summary?currency=EGP`,
      owner,
    )
  ).body;
  assert.equal(egp.total, 1000);
  assert.equal(fxCalls, calls + 1);

  // API down and today not cached -> last cached rates, flagged
  await db
    .model('ExchangeRate')
    .updateMany({ base: 'USD' }, { fetchedOn: '2026-01-01' });
  fxDown = true;
  const stale = (
    await api.get(
      `/itineraries/${detail.id}/budget-summary?currency=EUR`,
      owner,
    )
  ).body;
  assert.equal(stale.ratesAreLatest, false);
  assert.equal(stale.total, 18); // 20 USD * 0.9

  // API down and nothing cached -> 503
  await db.model('ExchangeRate').deleteMany({ base: 'USD' });
  const none = await api.get(
    `/itineraries/${detail.id}/budget-summary?currency=EUR`,
    owner,
  );
  assert.equal(none.status, 503);
  assert.equal(none.body.code, 'EXCHANGE_RATES_UNAVAILABLE');
  fxDown = false;
  assert.equal(
    (
      await api.get(
        `/itineraries/${detail.id}/budget-summary?currency=XYZ`,
        owner,
      )
    ).body.code,
    'VALIDATION_FAILED',
  );
});

test('hotels for a city group reuse hotel search with the group dates (ITN-25)', async () => {
  const owner = newUser();
  const hotel = await db.model('Hotel').create({
    name: 'Nile View',
    address: 'Corniche',
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
    startDate: new Date('2026-11-25T00:00:00Z'),
    endDate: new Date('2026-12-31T00:00:00Z'),
    kind: 'Available',
  });
  const detail = await withDays(owner, 'cairo', 'cairo', 'luxor');

  const res = await api.get(
    `/itineraries/${detail.id}/hotels?group=1&guests=2`,
    owner,
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.checkInDate, '2026-12-01');
  assert.equal(res.body.checkOutDate, '2026-12-03'); // the day after the group's last day
  assert.ok(
    res.body.results.items.some(
      (h) => String(h.hotelId ?? h.id ?? h._id) === String(hotel._id),
    ),
    JSON.stringify(res.body.results.items[0]),
  );
  assert.equal(
    (await api.get(`/itineraries/${detail.id}/hotels?group=3&guests=2`, owner))
      .body.code,
    'VALIDATION_FAILED',
  );
  assert.equal(
    (
      await api.get(
        `/itineraries/${detail.id}/hotels?group=1&guests=2`,
        newUser(),
      )
    ).body.code,
    'NOT_RESOURCE_OWNER',
  );
});

test('flights to the first day city reuse flight search with itinerary dates (ITN-26)', async () => {
  const owner = newUser();
  const empty = await createItinerary(owner);
  assert.equal(
    (
      await api.get(
        `/itineraries/${empty.id}/flights?departureAirport=DXB`,
        owner,
      )
    ).status,
    409,
  );

  const detail = await withDays(owner, 'cairo', 'cairo');
  const oneWay = await api.get(
    `/itineraries/${detail.id}/flights?departureAirport=dxb`,
    owner,
  );
  assert.equal(oneWay.status, 200, JSON.stringify(oneWay.body));
  assert.equal(oneWay.body.arrivalAirport, 'CAI');
  assert.ok(Array.isArray(oneWay.body.results.outbound.items));

  const round = await api.get(
    `/itineraries/${detail.id}/flights?departureAirport=DXB&tripType=round-trip`,
    owner,
  );
  assert.equal(round.status, 200, JSON.stringify(round.body));
  assert.equal(
    (
      await api.get(
        `/itineraries/${detail.id}/flights?departureAirport=DXB&arrivalAirport=DXB`,
        owner,
      )
    ).body.code,
    'VALIDATION_FAILED',
  );
  assert.equal(
    (
      await api.get(
        `/itineraries/${detail.id}/flights?departureAirport=DXB`,
        newUser(),
      )
    ).body.code,
    'NOT_RESOURCE_OWNER',
  );
});

// ------------------------------------------------------- ITN-21 public itineraries
let userSeq = 0;
async function makeUser(name, status = 'active') {
  const u = await db.model('User').create({
    name,
    email: `itn21-${++userSeq}-${Date.now()}@youssef-test.example`,
    passwordHash: 'x',
    status,
  });
  return String(u._id);
}
const publish = (id, owner) =>
  api.patch(`/itineraries/${id}`, owner, { visibility: 'public' });
const guestGet = (path) => request(http).get(`/api${path}`);

test('public search: keyword, country, city, duration; private, hidden and deactivated authors excluded (ITN-20, ITN-21, ACC-12, GEN-10)', async () => {
  const sara = await makeUser('Sara Ahmed');
  const gone = await makeUser('Gone User', 'deactivated');
  const tag = `Zq${Date.now()}`; // unique words so other tests' itineraries never match
  const nile = await withDays(sara, 'cairo', 'luxor');
  await api.patch(`/itineraries/${nile.id}`, sara, { title: `Nile ${tag}` });
  await publish(nile.id, sara);
  const dubai = await withDays(sara, 'dubai');
  await api.patch(`/itineraries/${dubai.id}`, sara, {
    title: `Desert ${tag}`,
    countries: ['AE'],
  });
  await publish(dubai.id, sara);
  const priv = await withDays(sara, 'cairo');
  await api.patch(`/itineraries/${priv.id}`, sara, { title: `Secret ${tag}` });
  const hidden = await withDays(sara, 'cairo');
  await api.patch(`/itineraries/${hidden.id}`, sara, {
    title: `Hidden ${tag}`,
  });
  await publish(hidden.id, sara);
  await db
    .model('Itinerary')
    .updateOne({ _id: hidden.id }, { hiddenAt: new Date() });
  const goneIt = await withDays(gone, 'cairo');
  await db
    .model('Itinerary')
    .updateOne(
      { _id: goneIt.id },
      { title: `Ghost ${tag}`, visibility: 'public' },
    );

  const titles = async (qs) =>
    (await guestGet(`/itineraries/public/search?${qs}`)).body.items
      .map((i) => i.title)
      .sort();
  assert.deepEqual(await titles(`q=${tag}`), [`Desert ${tag}`, `Nile ${tag}`]);
  const res = await guestGet(`/itineraries/public/search?q=${tag}`);
  assert.equal(res.status, 200, 'guests can search');
  assert.equal(res.body.items[0].author.name, 'Sara Ahmed');

  // keyword also matches a country name or a city name
  assert.ok((await titles('q=united arab')).includes(`Desert ${tag}`));
  assert.ok((await titles('q=luxor')).includes(`Nile ${tag}`));
  // filters
  assert.deepEqual(await titles(`q=${tag}&country=AE`), [`Desert ${tag}`]);
  assert.deepEqual(await titles(`q=${tag}&city=luxor`), [`Nile ${tag}`]);
  assert.deepEqual(await titles(`q=${tag}&minDays=2`), [`Nile ${tag}`]);
  assert.deepEqual(await titles(`q=${tag}&maxDays=1`), [`Desert ${tag}`]);
  // ITN-20: setting it private removes it immediately
  await api.patch(`/itineraries/${dubai.id}`, sara, { visibility: 'private' });
  assert.deepEqual(await titles(`q=${tag}`), [`Nile ${tag}`]);
});

test('public view: read-only for guests with author, days, activities, budget; private is 404 (ITN-21)', async () => {
  const sara = await makeUser('Sara Ahmed');
  const it = await withDays(sara, 'cairo');
  await api.post(
    `/itineraries/${it.id}/days/${it.days[0].id}/activities`,
    sara,
    { name: 'Pyramids', cost: 540, currency: 'EGP' },
  );
  assert.equal(
    (await guestGet(`/itineraries/public/${it.id}`)).status,
    404,
    'private',
  );
  await publish(it.id, sara);
  const view = await guestGet(`/itineraries/public/${it.id}`);
  assert.equal(view.status, 200, JSON.stringify(view.body));
  assert.equal(view.body.author.name, 'Sara Ahmed');
  assert.equal(view.body.days[0].activities[0].name, 'Pyramids');
  assert.equal(view.body.budget.total, 540);
  // read-only to others (ITN-20)
  assert.equal(
    (await api.patch(`/itineraries/${it.id}`, newUser(), { title: 'mine now' }))
      .body.code,
    'NOT_RESOURCE_OWNER',
  );
  assert.equal(
    (await api.get(`/itineraries/${it.id}`, newUser())).body.code,
    'NOT_RESOURCE_OWNER',
  );
});

test('clone: private, independent copy of days, activities, budgets, transport; credits the author (ITN-21, ITN-01)', async () => {
  const sara = await makeUser('Sara Ahmed');
  const omar = await makeUser('Omar');
  const src = await withDays(sara, 'cairo', 'luxor');
  const [d1, d2] = src.days.map((d) => d.id);
  await api.post(`/itineraries/${src.id}/days/${d1}/activities`, sara, {
    name: 'Pyramids',
    time: '09:00',
    cost: 540,
    currency: 'EGP',
  });
  await api.post(`/itineraries/${src.id}/days/${d1}/budgets`, sara, {
    category: 'food',
    amount: 300,
    currency: 'EGP',
  });
  await api.post(`/itineraries/${src.id}/transport-costs`, sara, {
    dayId: d2,
    mode: 'train',
    fromCityId: 'cairo',
    toCityId: 'luxor',
    amount: 1200,
    currency: 'EGP',
  });

  assert.equal(
    (await api.post(`/itineraries/${src.id}/clone`, omar)).status,
    404,
    'private cannot be cloned',
  );
  await publish(src.id, sara);
  const res = await api.post(`/itineraries/${src.id}/clone`, omar);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const clone = res.body;
  assert.notEqual(clone.id, src.id);
  assert.equal(clone.visibility, 'private');
  assert.equal(clone.clonedFrom.itineraryId, src.id);
  assert.equal(clone.clonedFrom.authorId, sara);
  assert.equal(clone.clonedFrom.authorName, 'Sara Ahmed');
  assert.deepEqual(summary(clone), summary(src));
  assert.equal(clone.days[0].activities[0].name, 'Pyramids');
  assert.equal(clone.days[0].budgetEntries[0].amount, 300);
  assert.equal(clone.days[1].transportCosts[0].mode, 'train');
  assert.notEqual(clone.days[0].id, d1, 'new day ids');
  // the clone belongs to Omar: he can edit it, Sara cannot
  assert.equal(
    (await api.patch(`/itineraries/${clone.id}`, omar, { title: 'My Egypt' }))
      .status,
    200,
  );
  assert.equal(
    (await api.get(`/itineraries/${clone.id}`, sara)).body.code,
    'NOT_RESOURCE_OWNER',
  );
  // independent: editing / deleting the original leaves the clone as it was
  await api.del(`/itineraries/${src.id}/days/${d1}`, sara);
  await api.del(`/itineraries/${src.id}`, sara);
  const after = (await api.get(`/itineraries/${clone.id}`, omar)).body;
  assert.equal(after.dayCount, 2);
  assert.equal(after.days[0].activities[0].name, 'Pyramids');

  // ACC-12: a deactivated original author is shown as "Deleted user"
  await db.model('User').updateOne({ _id: sara }, { status: 'deactivated' });
  assert.equal(
    (await api.get(`/itineraries/${clone.id}`, omar)).body.clonedFrom
      .authorName,
    'Deleted user',
  );
});

// ------------------------------------------------------- ITN-27, ITN-28 (bonus)
test('link my confirmed bookings to days; they feed the budget until cancelled (ITN-27)', async () => {
  const owner = newUser();
  const detail = await withDays(owner, 'cairo', 'luxor');
  const [d1, d2] = detail.days.map((d) => d.id);
  const snap = (userId, status, totalAmount) => ({
    bookingId: 'x',
    userId,
    status,
    totalAmount,
    currency: 'EGP',
    holdExpiresAt: null,
    startsAt: new Date(),
    policies: {},
  });
  const hotelId = String(new Types.ObjectId());
  const flightId = String(new Types.ObjectId());
  const pendingId = String(new Types.ObjectId());
  const othersId = String(new Types.ObjectId());
  fakeBookings.set(hotelId, snap(owner, 'Confirmed', 3000));
  fakeBookings.set(flightId, snap(owner, 'Completed', 2000));
  fakeBookings.set(pendingId, snap(owner, 'Pending Payment', 999));
  fakeBookings.set(othersId, snap(newUser(), 'Confirmed', 500));

  const url = `/itineraries/${detail.id}/bookings`;
  const h = await api.post(url, owner, {
    bookingType: 'hotel',
    bookingId: hotelId,
    dayId: d1,
  });
  assert.equal(h.status, 201, JSON.stringify(h.body));
  assert.equal(h.body.countsInBudget, true);
  await api.post(url, owner, {
    bookingType: 'flight',
    bookingId: flightId,
    dayId: d2,
  });
  assert.equal(
    (
      await api.post(url, owner, {
        bookingType: 'hotel',
        bookingId: hotelId,
        dayId: d2,
      })
    ).body.code,
    'BOOKING_ALREADY_LINKED',
  );
  assert.equal(
    (
      await api.post(url, owner, {
        bookingType: 'hotel',
        bookingId: pendingId,
        dayId: d1,
      })
    ).body.code,
    'BOOKING_NOT_LINKABLE',
  );
  assert.equal(
    (
      await api.post(url, owner, {
        bookingType: 'hotel',
        bookingId: othersId,
        dayId: d1,
      })
    ).status,
    404,
    "someone else's booking",
  );
  assert.equal(
    (
      await api.post(url, newUser(), {
        bookingType: 'hotel',
        bookingId: hotelId,
        dayId: d1,
      })
    ).body.code,
    'NOT_RESOURCE_OWNER',
  );

  const shown = (await api.get(`/itineraries/${detail.id}`, owner)).body;
  assert.equal(shown.days[0].linkedBookings[0].bookingId, hotelId);
  let s = (
    await api.get(
      `/itineraries/${detail.id}/budget-summary?currency=EGP`,
      owner,
    )
  ).body;
  assert.equal(s.byCategory.accommodation, 3000);
  assert.equal(s.byCategory.intercity_transport, 2000);
  assert.equal(s.total, 5000);

  // cancelled later -> still linked, no longer counted
  fakeBookings.set(hotelId, snap(owner, 'Cancelled', 3000));
  s = (
    await api.get(
      `/itineraries/${detail.id}/budget-summary?currency=EGP`,
      owner,
    )
  ).body;
  assert.equal(s.total, 2000);
  assert.equal(
    (await api.get(`/itineraries/${detail.id}`, owner)).body.days[0]
      .linkedBookings[0].countsInBudget,
    false,
  );

  assert.equal(
    (await api.del(`/itineraries/${detail.id}/bookings/${h.body.id}`, owner))
      .status,
    204,
  );
  assert.equal(
    (await api.del(`/itineraries/${detail.id}/bookings/${h.body.id}`, owner))
      .status,
    404,
  );
  // deleting the day removes its links
  await api.del(`/itineraries/${detail.id}/days/${d2}`, owner);
  assert.equal(
    await db
      .model('ItineraryBooking')
      .countDocuments({ itineraryId: detail.id }),
    0,
  );
});

test('export an itinerary as PDF, owner only (ITN-28)', async () => {
  const owner = newUser();
  const detail = await withDays(owner, 'cairo', 'luxor');
  await api.post(
    `/itineraries/${detail.id}/days/${detail.days[0].id}/activities`,
    owner,
    { name: 'Pyramids', time: '09:00', cost: 540, currency: 'EGP' },
  );
  const res = await api
    .get(`/itineraries/${detail.id}/pdf`, owner)
    .buffer(true)
    .parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /application\/pdf/);
  assert.match(
    res.headers['content-disposition'],
    /attachment; filename="Two-weeks-in-Egypt\.pdf"/,
  );
  assert.equal(res.body.subarray(0, 4).toString(), '%PDF');
  assert.equal(
    (await api.get(`/itineraries/${detail.id}/pdf`, newUser())).body.code,
    'NOT_RESOURCE_OWNER',
  );
});

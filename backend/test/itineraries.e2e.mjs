// Itineraries (ITN-01..ITN-26, taken over from Nada Gad's part) against a
// disposable local replica set. Never loads .env or touches the shared database.
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
          () => ({ UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'itn-uploads-')) }),
        ],
      }),
      MongooseModule.forRoot(mongo.getUri('itinerary_tests')),
      UsersModule,
      UploadsModule,
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
  await db
    .model('BudgetEntry')
    .create({
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

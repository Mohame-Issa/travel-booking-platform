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
  for (const m of Object.values(db.models)) await m.init();
  // Reference data the itinerary rules rely on (GEN-12): same ids as Countries.csv / Cities.csv.
  await db.model('Country').create([
    { _id: 'EG', code: 'EG', name: 'Egypt', currency: 'EGP' },
    { _id: 'AE', code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
  ]);
  await db.model('City').create([
    { _id: 'cairo', cityId: 'cairo', name: 'Cairo', countryCode: 'EG' },
    { _id: 'dubai', cityId: 'dubai', name: 'Dubai', countryCode: 'AE' },
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
    const day = await db
      .model('ItineraryDay')
      .create({
        itineraryId: target,
        userId: owner,
        dayNumber: 1,
        cityId: 'cairo',
      });
    await db
      .model('Activity')
      .create({
        itineraryId: target,
        dayId: day._id,
        userId: owner,
        name: 'Pyramids',
      });
    await db
      .model('BudgetEntry')
      .create({
        itineraryId: target,
        dayId: day._id,
        userId: owner,
        category: 'food',
        amount: 100,
        currency: 'EGP',
      });
    await db
      .model('TransportCost')
      .create({
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

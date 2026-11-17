// Blog (BLG-01..BLG-12, bonus scope; taken over from Omar Rashed's part) against
// a disposable local replica set. Never loads .env or touches the shared database.
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
import { BlogModule } from '../dist/blog/blog.module.js';
import { AllExceptionsFilter } from '../dist/common/filters/all-exceptions.filter.js';
import { RolesGuard } from '../dist/common/guards/roles.guard.js';
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
          () => ({ UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'blog-uploads-')) }),
        ],
      }),
      MongooseModule.forRoot(mongo.getUri('blog_tests')),
      UsersModule,
      UploadsModule,
      HistoryReaderStub,
      BlogModule,
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
async function user(name, status = 'active') {
  const u = await db.model('User').create({
    name,
    email: `blog${++seq}-${Date.now()}@youssef-test.example`,
    passwordHash: 'x',
    status,
  });
  return String(u._id);
}
const as = (u) => ({ 'x-test-user': u });
const api = {
  get: (p, u) =>
    u
      ? request(http).get(`/api${p}`).set(as(u))
      : request(http).get(`/api${p}`),
  post: (p, u, b) =>
    request(http)
      .post(`/api${p}`)
      .set(as(u))
      .send(b ?? {}),
  patch: (p, u, b) =>
    request(http)
      .patch(`/api${p}`)
      .set(as(u))
      .send(b ?? {}),
  del: (p, u) => request(http).delete(`/api${p}`).set(as(u)),
};
async function publish(author, body = {}) {
  const res = await api.post('/posts', author, {
    title: 'A trip',
    body: 'Body text',
    status: 'published',
    ...body,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('create, draft vs published, edit, tags (BLG-01, BLG-03, BLG-04, BLG-08)', async () => {
  const sara = await user('Sara');
  const draft = await api.post('/posts', sara, {
    title: 'Luxor',
    body: 'Notes',
    tags: [' Egypt ', 'history', 'egypt'],
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  assert.equal(draft.body.status, 'draft');
  assert.equal(draft.body.publishedAt, null);
  assert.deepEqual(
    draft.body.tags,
    ['egypt', 'history'],
    'trimmed, lower case, no duplicates',
  );

  assert.equal(
    (await api.post('/posts', sara, { body: 'x' })).body.code,
    'VALIDATION_FAILED',
  );
  assert.equal(
    (
      await api.post('/posts', sara, {
        title: 'x',
        body: 'x',
        tags: ['a', 'b', 'c', 'd', 'e', 'f'],
      })
    ).body.code,
    'VALIDATION_FAILED',
  );
  assert.equal(
    (
      await api.post('/posts', sara, {
        title: 'x',
        body: 'x',
        tags: ['a'.repeat(31)],
      })
    ).body.code,
    'VALIDATION_FAILED',
  );

  assert.equal(
    (await api.get(`/posts/${draft.body.id}`)).status,
    404,
    'drafts are not public',
  );
  const mine = (await api.get('/posts/mine', sara)).body;
  assert.equal(mine.items[0].status, 'draft');
  assert.equal(
    (await api.get(`/posts/mine/${draft.body.id}`, sara)).body.body,
    'Notes',
  );
  assert.equal(
    (await api.get(`/posts/mine/${draft.body.id}`, await user('Other'))).body
      .code,
    'NOT_RESOURCE_OWNER',
  );

  const pub = await api.patch(`/posts/${draft.body.id}`, sara, {
    status: 'published',
    tags: ['egypt'],
  });
  assert.equal(pub.body.status, 'published');
  assert.ok(pub.body.publishedAt);
  assert.equal(
    (await api.get(`/posts/${draft.body.id}`)).status,
    200,
    'now public',
  );
  assert.equal(
    (
      await api.patch(`/posts/${draft.body.id}`, await user('Other'), {
        title: 'hack',
      })
    ).body.code,
    'NOT_RESOURCE_OWNER',
  );
});

test('browse, tag filter and keyword search ordered by likes + comments (BLG-02, BLG-08, BLG-09, ACC-12)', async () => {
  const tag = `tg${Date.now()}`;
  const author = await user(`Mona ${tag}`);
  const quiet = await publish(author, { title: `Quiet ${tag}`, tags: [tag] });
  const popular = await publish(author, {
    title: `Popular ${tag}`,
    tags: [tag],
  });
  const newest = await publish(author, {
    title: 'No keyword in title',
    tags: ['other'],
  }); // matches by author name
  for (let i = 0; i < 2; i++)
    await api.post(`/posts/${popular.id}/like`, await user('Fan'));
  await api.post(`/posts/${popular.id}/comments`, await user('Fan'), {
    body: 'Nice',
  });

  const search = (await api.get(`/posts?q=${tag}`)).body.items.map(
    (p) => p.title,
  );
  assert.equal(search[0], `Popular ${tag}`, 'highest likes + comments first');
  assert.deepEqual(
    search.slice(1),
    ['No keyword in title', `Quiet ${tag}`],
    'then newest first',
  );
  assert.ok((await api.get(`/posts?q=${tag}`)).body.items[0].excerpt);

  assert.deepEqual(
    (await api.get(`/posts?tag=${tag}`)).body.items.map((p) => p.id),
    [popular.id, quiet.id],
  );
  assert.deepEqual(
    (await api.get(`/tags/${tag.toUpperCase()}/posts`)).body.items.map(
      (p) => p.id,
    ),
    [popular.id, quiet.id],
  );
  assert.deepEqual(
    (await api.get(`/posts?q=zzznothing${tag}`)).body.items,
    [],
    'no results',
  );

  // ACC-12: a deactivated author's posts disappear
  await db.model('User').updateOne({ _id: author }, { status: 'deactivated' });
  assert.deepEqual((await api.get(`/posts?q=${tag}`)).body.items, []);
  assert.equal((await api.get(`/posts/${newest.id}`)).status, 404);
});

test('comments: published posts only, 1-500 chars, chronological, own edit/delete (BLG-05, BLG-07)', async () => {
  const sara = await user('Sara');
  const omar = await user('Omar');
  const post = await publish(sara);
  const draft = (await api.post('/posts', sara, { title: 'd', body: 'd' }))
    .body;
  assert.equal(
    (await api.post(`/posts/${draft.id}/comments`, omar, { body: 'hi' }))
      .status,
    404,
  );
  assert.equal(
    (await api.post(`/posts/${post.id}/comments`, omar, { body: '   ' })).body
      .code,
    'VALIDATION_FAILED',
  );
  assert.equal(
    (
      await api.post(`/posts/${post.id}/comments`, omar, {
        body: 'x'.repeat(501),
      })
    ).body.code,
    'VALIDATION_FAILED',
  );

  const c1 = (
    await api.post(`/posts/${post.id}/comments`, omar, { body: 'First' })
  ).body;
  await api.post(`/posts/${post.id}/comments`, sara, { body: 'Second' });
  const page = (await api.get(`/posts/${post.id}`)).body;
  assert.deepEqual(
    page.comments.items.map((c) => c.body),
    ['First', 'Second'],
  );
  assert.equal(page.commentCount, 2);
  assert.equal(page.comments.items[0].author.name, 'Omar');

  assert.equal(
    (await api.patch(`/comments/${c1.id}`, sara, { body: 'hack' })).body.code,
    'NOT_RESOURCE_OWNER',
  );
  assert.equal(
    (await api.patch(`/comments/${c1.id}`, omar, { body: 'First (edited)' }))
      .body.body,
    'First (edited)',
  );
  assert.equal((await api.del(`/comments/${c1.id}`, omar)).status, 204);
  assert.equal((await api.get(`/posts/${post.id}`)).body.commentCount, 1);
  // ACC-12: comments of deactivated users show as "Deleted user"
  const c3 = (
    await api.post(`/posts/${post.id}/comments`, omar, { body: 'Bye' })
  ).body;
  await db.model('User').updateOne({ _id: omar }, { status: 'deactivated' });
  const names = (await api.get(`/posts/${post.id}/comments`)).body.items.map(
    (c) => [c.id, c.author.name],
  );
  assert.deepEqual(
    names.find(([id]) => id === c3.id),
    [c3.id, 'Deleted user'],
  );
});

test('likes: once per user even with parallel clicks, and removable (BLG-06)', async () => {
  const post = await publish(await user('Sara'));
  const fan = await user('Fan');
  const results = await Promise.all(
    Array.from({ length: 5 }, () => api.post(`/posts/${post.id}/like`, fan)),
  );
  assert.ok(results.every((r) => r.status === 200));
  assert.equal((await api.get(`/posts/${post.id}`)).body.likeCount, 1);
  const other = await api.post(`/posts/${post.id}/like`, await user('Another'));
  assert.deepEqual(other.body, { liked: true, likeCount: 2 });
  assert.deepEqual((await api.del(`/posts/${post.id}/like`, fan)).body, {
    liked: false,
    likeCount: 1,
  });
  assert.equal(
    (await request(http).post(`/api/posts/${post.id}/like`)).body.code,
    'INSUFFICIENT_ROLE',
    'login required',
  );
});

test('images through the shared upload service, max 5 (BLG-10, GEN-08)', async () => {
  const sara = await user('Sara');
  const post = await publish(sara);
  const ids = [];
  for (let i = 0; i < 6; i++)
    ids.push(
      String((await uploads.store({ buffer: PNG, size: PNG.length }, sara)).id),
    );
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await api.post(`/posts/${post.id}/images`, sara, { imageId: ids[i] }))
        .status,
      201,
    );
  assert.equal(
    (await api.post(`/posts/${post.id}/images`, sara, { imageId: ids[5] })).body
      .code,
    'IMAGE_LIMIT_REACHED',
  );
  assert.equal((await api.get(`/posts/${post.id}`)).body.images.length, 5);
  assert.equal(
    (await api.del(`/posts/${post.id}/images/${ids[0]}`, sara)).body.images
      .length,
    4,
  );
  assert.equal(
    (
      await api.post(`/posts/${post.id}/images`, await user('Other'), {
        imageId: ids[5],
      })
    ).body.code,
    'NOT_RESOURCE_OWNER',
  );
});

test('author page: name, join date, published posts, public itineraries (BLG-12)', async () => {
  const sara = await user('Sara Page');
  const pub = await publish(sara, { title: 'Public post' });
  await api.post('/posts', sara, { title: 'Draft post', body: 'x' });
  await db.model('Itinerary').create({
    userId: sara,
    title: 'Public trip',
    countries: ['EG'],
    startDate: new Date('2026-12-01T00:00:00Z'),
    visibility: 'public',
  });
  await db.model('Itinerary').create({
    userId: sara,
    title: 'Private trip',
    countries: ['EG'],
    startDate: new Date('2026-12-01T00:00:00Z'),
  });

  const page = await api.get(`/authors/${sara}`);
  assert.equal(page.status, 200, JSON.stringify(page.body));
  assert.equal(page.body.name, 'Sara Page');
  assert.ok(page.body.joinedAt);
  assert.deepEqual(
    page.body.posts.items.map((p) => p.id),
    [pub.id],
  );
  assert.deepEqual(
    page.body.itineraries.items.map((i) => i.title),
    ['Public trip'],
  );
  await db.model('User').updateOne({ _id: sara }, { status: 'deactivated' });
  assert.equal((await api.get(`/authors/${sara}`)).status, 404);
  assert.equal((await api.get(`/authors/${new Types.ObjectId()}`)).status, 404);
});

test('deleting a post removes its comments and likes (BLG-04)', async () => {
  const sara = await user('Sara');
  const post = await publish(sara);
  await api.post(`/posts/${post.id}/comments`, sara, { body: 'x' });
  await api.post(`/posts/${post.id}/like`, sara);
  assert.equal(
    (await api.del(`/posts/${post.id}`, await user('Other'))).body.code,
    'NOT_RESOURCE_OWNER',
  );
  assert.equal((await api.del(`/posts/${post.id}`, sara)).status, 204);
  assert.equal(
    await db.model('Comment').countDocuments({ postId: post.id }),
    0,
  );
  assert.equal(await db.model('Like').countDocuments({ postId: post.id }), 0);
  assert.equal((await api.get(`/posts/${post.id}`)).status, 404);
});

test('attach my itinerary to my post; readers see it only while public (BLG-13)', async () => {
  const sara = await user('Sara Trip');
  const post = await publish(sara, { title: 'Our Egypt trip' });
  const mk = (owner, visibility) =>
    db
      .model('Itinerary')
      .create({
        userId: owner,
        title: `It ${visibility}`,
        countries: ['EG'],
        startDate: new Date('2026-12-01T00:00:00Z'),
        visibility,
      });
  const priv = await mk(sara, 'private');
  const someoneElses = await mk(await user('Other'), 'public');

  assert.equal(
    (
      await api.patch(`/posts/${post.id}/itinerary`, sara, {
        itineraryId: String(someoneElses._id),
      })
    ).body.code,
    'NOT_RESOURCE_OWNER',
  );
  assert.equal(
    (
      await api.patch(`/posts/${post.id}/itinerary`, sara, {
        itineraryId: String(new Types.ObjectId()),
      })
    ).status,
    404,
  );
  assert.equal(
    (await api.patch(`/posts/${post.id}/itinerary`, sara, {})).body.code,
    'VALIDATION_FAILED',
  );
  assert.equal(
    (
      await api.patch(`/posts/${post.id}/itinerary`, await user('Hacker'), {
        itineraryId: null,
      })
    ).body.code,
    'NOT_RESOURCE_OWNER',
  );

  const attached = await api.patch(`/posts/${post.id}/itinerary`, sara, {
    itineraryId: String(priv._id),
  });
  assert.equal(attached.status, 200, JSON.stringify(attached.body));
  assert.equal(
    attached.body.itinerary.id,
    String(priv._id),
    'the author sees it',
  );
  assert.equal(attached.body.itinerary.author.name, 'Sara Trip');
  assert.equal(
    (await api.get(`/posts/${post.id}`)).body.itinerary,
    null,
    'private: readers see no itinerary',
  );

  await db
    .model('Itinerary')
    .updateOne({ _id: priv._id }, { visibility: 'public' });
  assert.equal(
    (await api.get(`/posts/${post.id}`)).body.itinerary.title,
    'It private',
    'public now: readers see it',
  );
  await db
    .model('Itinerary')
    .updateOne({ _id: priv._id }, { hiddenAt: new Date() });
  assert.equal(
    (await api.get(`/posts/${post.id}`)).body.itinerary,
    null,
    'hidden by an admin',
  );

  const detached = await api.patch(`/posts/${post.id}/itinerary`, sara, {
    itineraryId: null,
  });
  assert.equal(detached.body.itinerary, null);
});

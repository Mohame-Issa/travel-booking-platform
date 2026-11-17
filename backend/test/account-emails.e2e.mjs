// Youssef Khafagy: ACC-02 (email verification) and ACC-07 (forgot password)
// end to end on the REAL auth, users and account-email modules, against a
// disposable local replica set. Emails go to an in-memory inbox instead of
// SMTP. Never loads .env or touches the shared database.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { AccountEmailModule } from '../dist/auth/account-email.module.js';
import { AuthModule } from '../dist/auth/auth.module.js';
import { AllExceptionsFilter } from '../dist/common/filters/all-exceptions.filter.js';
import { RolesGuard } from '../dist/common/guards/roles.guard.js';
import { createValidationPipe } from '../dist/common/pipes/validation.pipe.js';
import { MailModule } from '../dist/mail/mail.module.js';
import { MailService } from '../dist/mail/mail.service.js';
import { UsersModule } from '../dist/users/users.module.js';

const inbox = [];
const fakeMail = { send: async (m) => void inbox.push(m) };
const lastMailTo = (to) => inbox.filter((m) => m.to === to).at(-1);
const tokenIn = (mail) => /token=([A-Za-z0-9_-]+)/.exec(mail.text)[1];

class TestAuthGuard {
  canActivate(ctx) {
    const req = ctx.switchToHttp().getRequest();
    const id = req.headers['x-test-user'];
    if (id)
      req.user = {
        id,
        email: 'x',
        name: 'x',
        role: 'user',
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
          () => ({
            JWT_SECRET: 'e2e-only-secret-0123456789abcdef0123',
            FRONTEND_URL: 'http://front.test',
          }),
        ],
      }),
      MongooseModule.forRoot(mongo.getUri('youssef_account_emails_tests')),
      UsersModule,
      MailModule,
      AuthModule,
      AccountEmailModule,
    ],
    providers: [
      { provide: APP_GUARD, useClass: TestAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
    ],
  })
    .overrideProvider(MailService)
    .useValue(fakeMail)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  http = app.getHttpServer();
  db = app.get(getConnectionToken());
  for (const m of Object.values(db.models)) await m.init();
});

after(async () => {
  if (app) await app.close();
  if (mongo) await mongo.stop();
});

let n = 0;
async function register() {
  const email = `user${++n}@youssef-test.example`;
  const res = await request(http)
    .post('/api/auth/register')
    .send({
      name: 'Test User',
      email,
      password: 'Travel2026',
      acceptTerms: true,
    });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { email, id: res.body.id, body: res.body };
}

// ================================================================== ACC-02

test('ACC-02: registration emails a verification link; the account starts unverified', async () => {
  const { email, body } = await register();
  assert.equal(body.emailVerified, false);
  const mail = lastMailTo(email);
  assert.ok(mail, 'verification email sent');
  assert.match(mail.text, /http:\/\/front\.test\/verify-email\?token=/);
  const row = await db
    .collection('emailtokens')
    .findOne({ purpose: 'verify_email' });
  assert.notEqual(row.tokenHash, tokenIn(mail)); // only a hash is stored
});

test('ACC-02: the link verifies once; a used or made-up link is refused', async () => {
  const { email, id } = await register();
  const token = tokenIn(lastMailTo(email));
  const ok = await request(http).post('/api/auth/verify-email').send({ token });
  assert.equal(ok.status, 200);
  assert.equal(
    (await db.collection('users').findOne({ email })).emailVerified,
    true,
  );

  const again = await request(http)
    .post('/api/auth/verify-email')
    .send({ token });
  assert.equal(again.status, 400);
  assert.equal(again.body.code, 'INVALID_EMAIL_TOKEN');
  const fake = await request(http)
    .post('/api/auth/verify-email')
    .send({ token: 'x'.repeat(43) });
  assert.equal(fake.status, 400);

  const resend = await request(http)
    .post('/api/auth/resend-verification')
    .set('x-test-user', id);
  assert.equal(resend.status, 409);
  assert.equal(resend.body.code, 'EMAIL_ALREADY_VERIFIED');
});

test('ACC-02: a new link replaces the old one', async () => {
  const { email, id } = await register();
  const first = tokenIn(lastMailTo(email));
  const resend = await request(http)
    .post('/api/auth/resend-verification')
    .set('x-test-user', id);
  assert.equal(resend.status, 200);
  const second = tokenIn(lastMailTo(email));
  assert.notEqual(first, second);
  assert.equal(
    (await request(http).post('/api/auth/verify-email').send({ token: first }))
      .status,
    400,
  );
  assert.equal(
    (await request(http).post('/api/auth/verify-email').send({ token: second }))
      .status,
    200,
  );
});

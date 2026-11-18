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
            BACKEND_URL: 'http://api.test',
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
  const res = await request(http).post('/api/auth/register').send({
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
  assert.match(
    mail.text,
    /http:\/\/api\.test\/api\/auth\/verify-email\?token=/,
  );
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

test('ACC-02: clicking the emailed link verifies and shows a page; a second click shows an error page', async () => {
  const { email } = await register();
  const link = new URL(/(http\S+)/.exec(lastMailTo(email).text)[1]);
  const first = await request(http).get(`${link.pathname}${link.search}`);
  assert.equal(first.status, 200);
  assert.match(first.headers['content-type'], /text\/html/);
  assert.match(first.text, /Email verified/);
  assert.equal(
    (await db.collection('users').findOne({ email })).emailVerified,
    true,
  );

  const second = await request(http).get(`${link.pathname}${link.search}`);
  assert.equal(second.status, 400);
  assert.match(second.text, /Link not valid/);
  assert.equal((await request(http).get('/api/auth/verify-email')).status, 400); // no token
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

// ================================================================== ACC-07

/** The reset email is sent in the background; wait for it. */
async function resetMail(email, count) {
  for (let i = 0; i < 100; i++) {
    const mails = inbox.filter(
      (m) => m.to === email && m.subject === 'Reset your password',
    );
    if (mails.length >= count) return mails[count - 1];
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('no reset email');
}
const forgot = (email) =>
  request(http).post('/api/auth/forgot-password').send({ email });
const reset = (token, newPassword = 'NewPass2026') =>
  request(http).post('/api/auth/reset-password').send({ token, newPassword });
const login = (email, password) =>
  request(http).post('/api/auth/login').send({ email, password });

test('ACC-07: same answer whether or not the email exists', async () => {
  const { email } = await register();
  const known = await forgot(email);
  const unknown = await forgot('nobody@youssef-test.example');
  assert.equal(known.status, 200);
  assert.deepEqual(unknown.status, known.status);
  assert.deepEqual(unknown.body, known.body);
  await resetMail(email, 1);
  assert.equal(
    inbox.filter((m) => m.to === 'nobody@youssef-test.example').length,
    0,
  );
});

test('ACC-07: the link resets the password once, logs out every session and verifies the email', async () => {
  const { email, id } = await register();
  await db.collection('sessions').insertOne({
    userId: new (await import('mongoose')).Types.ObjectId(id),
    revokedAt: null,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await forgot(email);
  const token = tokenIn(await resetMail(email, 1));

  const weak = await reset(token, 'short');
  assert.equal(weak.status, 400); // password rules (ACC-01) still apply

  assert.equal((await reset(token)).status, 200);
  assert.equal((await login(email, 'Travel2026')).status, 401);
  assert.equal((await login(email, 'NewPass2026')).status, 200);
  const user = await db.collection('users').findOne({ email });
  assert.equal(user.emailVerified, true);
  const open = await db.collection('sessions').countDocuments({
    userId: user._id,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
  assert.equal(open, 1); // only the new login's session

  const reused = await reset(token, 'Another2026');
  assert.equal(reused.status, 400);
  assert.equal(reused.body.code, 'INVALID_EMAIL_TOKEN');
});

test('ACC-07: a newer request cancels the older link; links expire after 30 minutes', async () => {
  const { email } = await register();
  await forgot(email);
  const first = tokenIn(await resetMail(email, 1));
  await forgot(email);
  const second = tokenIn(await resetMail(email, 2));
  assert.equal((await reset(first)).status, 400);

  const row = await db.collection('emailtokens').findOne({
    purpose: 'reset_password',
    usedAt: null,
    userId: (await db.collection('users').findOne({ email }))._id,
  });
  const minutes = (row.expiresAt - row.createdAt) / 60_000;
  assert.ok(Math.abs(minutes - 30) < 0.1, `expires after ${minutes} minutes`);
  await db
    .collection('emailtokens')
    .updateOne(
      { _id: row._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
  assert.equal((await reset(second)).status, 400);
});

test('ACC-07: clicking the emailed link opens a form that resets the password', async () => {
  const { email } = await register();
  await forgot(email);
  const mail = await resetMail(email, 1);
  const link = new URL(/(http\S+)/.exec(mail.text)[1]);
  assert.equal(link.origin, 'http://api.test');
  const token = link.searchParams.get('token');

  const form = await request(http).get(`${link.pathname}${link.search}`);
  assert.equal(form.status, 200);
  assert.match(form.text, /Choose a new password/);

  const submit = (fields) =>
    request(http)
      .post('/api/auth/reset-password/form')
      .type('form')
      .send({ token, ...fields });
  const mismatch = await submit({
    newPassword: 'Garden2026',
    confirmPassword: 'Garden2027',
  });
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.text, /not the same/);
  const weak = await submit({
    newPassword: 'abcdefgh',
    confirmPassword: 'abcdefgh',
  });
  assert.equal(weak.status, 400);
  assert.match(weak.text, /at least one digit/);

  const ok = await submit({
    newPassword: 'Garden2026',
    confirmPassword: 'Garden2026',
  });
  assert.equal(ok.status, 200);
  assert.match(ok.text, /Password changed/);
  assert.equal((await login(email, 'Garden2026')).status, 200);

  const again = await request(http).get(`${link.pathname}${link.search}`);
  assert.equal(again.status, 400);
  assert.match(again.text, /Link not valid/);
  const reused = await submit({
    newPassword: 'Other2026x',
    confirmPassword: 'Other2026x',
  });
  assert.equal(reused.status, 400);
  assert.match(reused.text, /Link not valid/);
});

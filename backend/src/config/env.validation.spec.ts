import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.validation.js';

const base = { MONGODB_URI: 'mongodb://x', JWT_SECRET: 'a'.repeat(32) };

describe('validateEnv - Stripe variables (PAY-01)', () => {
  it('treats empty Stripe lines as not set', () => {
    const env = validateEnv({
      ...base,
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
    });
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.STRIPE_WEBHOOK_SECRET).toBeUndefined();
  });

  it('rejects a live key', () => {
    expect(() =>
      validateEnv({ ...base, STRIPE_SECRET_KEY: 'sk_live_abc' }),
    ).toThrow(/STRIPE_SECRET_KEY/);
  });

  it('accepts test-mode values', () => {
    const env = validateEnv({
      ...base,
      STRIPE_SECRET_KEY: 'sk_test_abc',
      STRIPE_WEBHOOK_SECRET: 'whsec_abc',
    });
    expect(env.STRIPE_SECRET_KEY).toBe('sk_test_abc');
  });
});

describe('validateEnv - empty lines copied from .env.example', () => {
  it('treats empty optional values as not set (app uses its defaults)', () => {
    const env = validateEnv({
      ...base,
      PORT: '',
      COOKIE_SECURE: '',
      COOKIE_SAMESITE: '',
      FRONTEND_URL: '',
      UPLOAD_DIR: '',
    });
    expect(env.PORT).toBeUndefined();
    expect(env.COOKIE_SECURE).toBeUndefined();
    expect(env.COOKIE_SAMESITE).toBeUndefined();
    expect(env.FRONTEND_URL).toBeUndefined();
  });

  it('still parses real values', () => {
    const env = validateEnv({
      ...base,
      PORT: '4000',
      COOKIE_SECURE: 'false',
      COOKIE_SAMESITE: 'strict',
    });
    expect(env.PORT).toBe(4000);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.COOKIE_SAMESITE).toBe('strict');
  });

  it('still rejects invalid values', () => {
    expect(() => validateEnv({ ...base, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...base, COOKIE_SAMESITE: 'x' })).toThrow(
      /COOKIE_SAMESITE/,
    );
  });

  it('still requires MONGODB_URI and JWT_SECRET', () => {
    expect(() => validateEnv({ ...base, MONGODB_URI: '' })).toThrow(
      /MONGODB_URI/,
    );
    expect(() => validateEnv({ ...base, JWT_SECRET: '' })).toThrow(
      /JWT_SECRET/,
    );
  });
});

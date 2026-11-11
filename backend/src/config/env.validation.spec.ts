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

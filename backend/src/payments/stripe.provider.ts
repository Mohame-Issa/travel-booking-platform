import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { STRIPE_CLIENT } from './payments.constants.js';

/**
 * Creates the Stripe client from STRIPE_SECRET_KEY in backend/.env.
 * The key is never hard-coded, logged, or returned in a response.
 * env.validation.ts already guarantees it is a TEST key (sk_test_...).
 *
 * The key is optional so teammates without a Stripe account can still start
 * the app. Then this provider is `null` and the payment endpoints answer
 * 503 STRIPE_NOT_CONFIGURED instead of crashing the whole backend.
 */
export const stripeProvider: Provider = {
  provide: STRIPE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Stripe | null => {
    const key = config.get<string>('STRIPE_SECRET_KEY');
    if (!key) {
      new Logger('Stripe').warn(
        'STRIPE_SECRET_KEY is not set: payment endpoints are disabled',
      );
      return null;
    }
    // No apiVersion given: the SDK pins the API version it was built for.
    return new Stripe(key);
  },
};

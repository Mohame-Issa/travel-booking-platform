import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

/**
 * Environment variables the backend needs. Values come from backend/.env
 * (never committed). Variable NAMES are documented in /.env.example.
 * The app refuses to start if a required variable is missing or invalid.
 */
export class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  MONGODB_URI: string;

  /** Secret used to sign access tokens. At least 32 random characters. */
  @IsString()
  @MinLength(32)
  JWT_SECRET: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT?: number;

  /** Set to "false" only if your browser refuses Secure cookies on http://localhost. */
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : String(value).toLowerCase() !== 'false',
  )
  @IsBoolean()
  COOKIE_SECURE?: boolean;

  @IsOptional()
  @IsIn(['lax', 'strict', 'none'])
  COOKIE_SAMESITE?: 'lax' | 'strict' | 'none';

  /** Frontend origin allowed to call the API with cookies (Milestone 2). */
  @IsOptional()
  @IsString()
  FRONTEND_URL?: string;

  /**
   * Stripe secret key (PAY-01). TEST mode only, so it must start with sk_test_.
   * Optional: without it the app starts but payment endpoints answer 503.
   */
  @IsOptional()
  @Matches(/^sk_test_/, { message: 'must be a Stripe TEST key (sk_test_...)' })
  STRIPE_SECRET_KEY?: string;

  /** Signing secret of the webhook endpoint or of `stripe listen` (whsec_...). */
  @IsOptional()
  @Matches(/^whsec_/, {
    message: 'must be a Stripe webhook secret (whsec_...)',
  })
  STRIPE_WEBHOOK_SECRET?: string;

  /**
   * Optional FXRatesAPI key (ITN-18). The free tier works without one; if set,
   * it is sent as a header from the backend only.
   */
  @IsOptional()
  @IsString()
  FXRATES_API_KEY?: string;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  // An empty line like `PORT=` (as copied from .env.example) means "not set",
  // so optional variables fall back to their defaults instead of failing
  // validation. Required ones (MONGODB_URI, JWT_SECRET) still fail when empty.
  const withoutEmpty = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [
      key,
      value === '' ? undefined : value,
    ]),
  );
  const validated = plainToInstance(EnvironmentVariables, withoutEmpty, {
    enableImplicitConversion: false,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    // Only property NAMES are printed, never their values.
    const problems = errors
      .map(
        (e) =>
          `  - ${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`,
      )
      .join('\n');
    throw new Error(
      `Invalid or missing environment variables in backend/.env:\n${problems}\n` +
        'See .env.example and README.md for the required variable names.',
    );
  }
  return validated;
}

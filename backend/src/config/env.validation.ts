import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
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
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
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

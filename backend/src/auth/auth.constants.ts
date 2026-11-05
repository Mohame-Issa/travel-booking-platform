/** ACC-06: a session with no authenticated request for 30 minutes expires. */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Short-lived access token; the frontend calls POST /api/auth/refresh when it expires. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Only write lastActivityAt at most once per minute, to avoid a DB write on every request. */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;

/** ACC-05 */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

/** GEN-13: bcrypt cost factor. */
export const BCRYPT_ROUNDS = 12;

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';
/** The refresh cookie is only sent to the auth endpoints. */
export const REFRESH_TOKEN_COOKIE_PATH = '/api/auth';

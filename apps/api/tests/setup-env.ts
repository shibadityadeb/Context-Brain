/**
 * Test environment defaults.
 *
 * `src/config/env.ts` fails fast on a missing secret so a service can never boot
 * half-configured — which also means any test importing a module that reaches
 * config throws unless those variables exist. A developer's `.env` supplies them
 * locally; CI has none, so the suite would pass on a laptop and fail on a
 * runner. These placeholders close that gap.
 *
 * Assigned only when unset, so a real `.env` (and CI secrets, if ever provided)
 * still win. The values are deliberately inert: nothing here connects anywhere,
 * and any test that needs a live dependency must stub it explicitly.
 */

const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
  JWT_ACCESS_SECRET: 'test-access-secret-not-a-real-key',
  JWT_REFRESH_SECRET: 'test-refresh-secret-not-a-real-key',
  COOKIE_SECRET: 'test-cookie-secret-not-a-real-key',
  STORAGE_ACCESS_KEY: 'test-storage-access-key',
  STORAGE_SECRET_KEY: 'test-storage-secret-key',
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] ??= value;
}

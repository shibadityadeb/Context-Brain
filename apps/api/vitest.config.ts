import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Runs before any test module is imported, so a suite that pulls in
    // `src/config` (which fails fast on missing secrets) works on a CI runner
    // with no .env, not just on a developer machine that has one.
    setupFiles: ['./tests/setup-env.ts'],
  },
});

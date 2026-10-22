import { applyIntegrationEnv, assertSafeTestDatabase } from './env.js';

// Runs in each test worker before any test module is imported, so
// `src/config` parses the hermetic integration environment.
applyIntegrationEnv();
assertSafeTestDatabase(process.env.DATABASE_URL!);

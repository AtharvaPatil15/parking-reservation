import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './tests/integration/config';

/**
 * Integration-test config (P4-19). Provisions a throwaway Postgres DB in globalSetup and points
 * the app/Prisma at it via `env`. Serialized (single fork) since tests share the database.
 * Run with: `npm run test:integration`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.integration.test.ts'],
    globalSetup: ['tests/integration/globalSetup.ts'],
    env: { DATABASE_URL: TEST_DATABASE_URL, NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});

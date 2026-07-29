import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { MAINTENANCE_DATABASE_URL, TEST_DATABASE_URL, TEST_DB_NAME } from './config';

/**
 * Vitest globalSetup for integration tests (P4-19). Provisions a throwaway Postgres database on the
 * local container — user-approved; never the dev `parking_poc`, never a remote/prod server:
 *   1. DROP + CREATE the `parking_poc_test` database (explicit SQL on the maintenance connection),
 *      guaranteeing a clean, empty DB each run.
 *   2. `prisma db push` (plain, additive — no destructive reset flag) creates the schema.
 *   3. `prisma db seed` loads the baseline fixtures (companies, users, slots, quota, config).
 */
export default async function globalSetup(): Promise<void> {
  // 1. Recreate the scratch DB from the maintenance `postgres` database.
  const admin = new PrismaClient({ datasourceUrl: MAINTENANCE_DATABASE_URL });
  try {
    // Terminate any lingering connections so DROP can proceed.
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      TEST_DB_NAME,
    );
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}"`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB_NAME}"`);
  } finally {
    await admin.$disconnect();
  }

  // 2 + 3. Create schema + seed against the empty test DB. Local-only; --use-system-ca + npmjs
  // registry guard the same corp-network quirks documented for `prisma generate`.
  const env = {
    ...process.env,
    DATABASE_URL: TEST_DATABASE_URL,
    NODE_OPTIONS: '--use-system-ca',
    npm_config_registry: 'https://registry.npmjs.org/',
  };
  execSync('npx prisma db push --skip-generate', { stdio: 'inherit', env });
  execSync('npx prisma db seed', { stdio: 'inherit', env });
}

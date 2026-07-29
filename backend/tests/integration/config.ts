
/**
 * Integration-test database config. A dedicated *throwaway* database on the local Postgres
 * container — provisioned fresh (schema + seed) by globalSetup and never the dev `parking_poc`.
 * Override host/creds via env if your local Postgres differs.
 */
const HOST = process.env.TEST_PG_HOST ?? '127.0.0.1';
const PORT = process.env.TEST_PG_PORT ?? '5432';
const USER = process.env.TEST_PG_USER ?? 'postgres';
const PASS = process.env.TEST_PG_PASSWORD ?? 'password123';

export const TEST_DB_NAME = process.env.TEST_PG_DB ?? 'parking_poc_test';
export const MAINTENANCE_DATABASE_URL = `postgresql://${USER}:${PASS}@${HOST}:${PORT}/postgres`;
export const TEST_DATABASE_URL = `postgresql://${USER}:${PASS}@${HOST}:${PORT}/${TEST_DB_NAME}?schema=public`;

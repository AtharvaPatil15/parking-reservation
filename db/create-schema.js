#!/usr/bin/env node
/**
 * Parking POC — create the database + all schema in the running Postgres container.
 *
 * What it does:
 *   1. Connects to the Postgres server (maintenance DB) using PG* env vars.
 *   2. Creates a NEW database (default: parking_poc) if it doesn't already exist.
 *   3. Runs db/schema.sql (generated from prisma/schema.prisma) to create every
 *      enum, table, index and foreign key — inside a single transaction.
 *   4. Applies the F7 partial-unique index on User.email (allows re-use after soft delete).
 *
 * Usage (from the db/ folder):
 *   npm install
 *   node create-schema.js
 *
 * Connection (env vars — pg reads these natively; defaults suit the local container):
 *   PGHOST=127.0.0.1  PGPORT=5432  PGUSER=postgres  PGPASSWORD=postgres
 *   TARGET_DB=parking_poc        # the new database to create
 *   ADMIN_DB=postgres            # maintenance DB used to issue CREATE DATABASE
 *   RESET=true                   # optional: DROP the target DB first (fresh rebuild)
 *
 * Example (PowerShell): $env:PGPASSWORD="postgres"; $env:RESET="true"; node create-schema.js
 * Example (bash):       PGPASSWORD=postgres RESET=true node create-schema.js
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const CONN = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
};
const ADMIN_DB = process.env.ADMIN_DB || 'postgres';
const TARGET_DB = process.env.TARGET_DB || 'parking_poc';
const RESET = /^(1|true|yes)$/i.test(process.env.RESET || '');

// Guard the DB name — it is interpolated as an identifier, not a bound parameter.
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(TARGET_DB)) {
  console.error(`Invalid TARGET_DB name: "${TARGET_DB}". Use letters, digits, underscore.`);
  process.exit(1);
}

const log = (msg) => console.log(`[create-schema] ${msg}`);

async function main() {
  const schemaSqlPath = path.join(__dirname, 'schema.sql');
  if (!fs.existsSync(schemaSqlPath)) {
    throw new Error(`Missing ${schemaSqlPath}. Generate it from the Prisma schema first.`);
  }
  const schemaSql = fs.readFileSync(schemaSqlPath, 'utf8');

  // --- 1 & 2: connect to maintenance DB, (optionally reset) create target DB ---
  const admin = new Client({ ...CONN, database: ADMIN_DB });
  await admin.connect();
  log(`connected to ${CONN.user}@${CONN.host}:${CONN.port}/${ADMIN_DB}`);

  if (RESET) {
    log(`RESET=true → dropping database "${TARGET_DB}" if it exists`);
    // Terminate other sessions so DROP can proceed.
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TARGET_DB]
    );
    await admin.query(`DROP DATABASE IF EXISTS "${TARGET_DB}"`);
  }

  const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [TARGET_DB]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${TARGET_DB}"`);
    log(`created database "${TARGET_DB}"`);
  } else {
    log(`database "${TARGET_DB}" already exists — reusing (pass RESET=true for a clean rebuild)`);
  }
  await admin.end();

  // --- 3: run the schema DDL inside a transaction ---
  const db = new Client({ ...CONN, database: TARGET_DB });
  await db.connect();
  log(`connected to target database "${TARGET_DB}" — applying schema.sql`);
  try {
    await db.query('BEGIN');
    await db.query(schemaSql);

    // --- 4: F7 partial-unique index on User.email ---
    await db.query(`DROP INDEX IF EXISTS "User_email_key"`);
    await db.query(
      `CREATE UNIQUE INDEX "User_email_active_key" ON "User"("email") WHERE "deletedAt" IS NULL`
    );

    await db.query('COMMIT');
    log('schema applied (F7 partial-unique index in place)');
  } catch (err) {
    await db.query('ROLLBACK');
    if (/already exists/i.test(err.message)) {
      log('schema objects already exist — nothing changed. Re-run with RESET=true to rebuild.');
    } else {
      throw err;
    }
  }

  // --- verify ---
  const tables = await db.query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  log(`done — ${tables.rows[0].n} tables in ${TARGET_DB}.public`);
  await db.end();
}

main().catch((err) => {
  console.error('[create-schema] FAILED:', err.message);
  process.exit(1);
});

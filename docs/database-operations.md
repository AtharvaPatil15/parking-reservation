# Database operations

Day-to-day database commands: which database you are pointed at, how to clear one back to a usable
minimum, how to apply a migration, and how to rebuild a local one.

First-time deployment setup is **not** here — see [`deployment.md`](deployment.md) §1–2 for creating the
Supabase project, connection strings, and the initial migrate → indexes → seed sequence.

All commands run from `backend/`.

---

## 0 · Which database am I about to change?

Do this first, every time. `backend/.env` points at **Supabase — the shared deployed database**, not
localhost, so a command that looks local is not.

```bash
cd backend
npx prisma migrate status
```

The `Datasource "db"` line names the host. `aws-0-…pooler.supabase.com` means **you are on the deployed
database and every change is live for everyone.**

To act on a local database instead, override both variables — Prisma's `directUrl` is read from
`DIRECT_URL`, and leaving it inherited from `.env` sends migrations to Supabase even when
`DATABASE_URL` is local:

```bash
export DATABASE_URL="postgresql://postgres:password123@127.0.0.1:5432/parking_poc"
export DIRECT_URL="$DATABASE_URL"
```

> **PowerShell:** `$env:DATABASE_URL="…"; $env:DIRECT_URL=$env:DATABASE_URL`

> **Bash gotcha:** `export A=... B=$A` does *not* work — `$A` expands before `A` is assigned. Use two
> separate `export` statements.

---

## 1 · Clear a database back to the minimum that still works

**Use [`prisma/sql/reset-keep-superadmin.sql`](../backend/prisma/sql/reset-keep-superadmin.sql).**

It leaves exactly one Super Admin login and the reference data the app cannot boot without, and deletes
every company, user, slot, quota, booking, allocation, vehicle, gate event, audit row and session.

It is **transactional and idempotent** — safe to re-run, and if anything fails nothing is deleted. It
refuses to run at all unless it finds exactly one Super Admin matching the email pinned in step 0 of the
file (`superadmin@redbricks.example`, which is what the deployed database currently has).

*Verified 2026-08-23 against a throwaway copy of the full dev seed:* the reset leaves 1 user, 1 company,
4 roles and 19 config rows with everything else zeroed; a second run is a no-op; on a mismatched Super
Admin email it raises and rolls back without deleting anything; and the app is fully rebuildable from the
result — see "Does the app still run afterwards?" below.

> **Fixed 2026-08-23:** `VehicleRegistrationRequest` was missing from the script's `TRUNCATE` list. Its
> `companyId` is a required FK defaulting to `RESTRICT`, and its link to `Vehicle` is a *soft* ref
> (`vehicleId`, no `@relation`), so `TRUNCATE "Vehicle" CASCADE` never reached it. One leftover walk-in
> car registration therefore made the company delete fail and rolled the whole reset back. Harmless — the
> transaction protected the data — but the script could not complete on any database where a guard had
> registered a walk-in car. If you are running an older copy of this file, take the current one.

### `npm run db:wipe` will NOT do this on Supabase

[`prisma/wipe.ts`](../backend/prisma/wipe.ts) is the script you would reach for, and it hard-refuses any
`DATABASE_URL` that is not `localhost` / `127.0.0.1` / `host.docker.internal`. That is deliberate — it is
a local-only tool. Use the SQL script above for anything hosted.

### How to run it against Supabase

**Option A — Supabase SQL Editor (recommended).** Paste the file contents and run. This is the only route
that shows you the script's own verification output: a row-count table and the surviving login.

**Option B — from your laptop.**

```bash
cd backend
npx prisma db execute --file prisma/sql/reset-keep-superadmin.sql --schema prisma/schema.prisma
```

Prints only `Script executed successfully.` — `db execute` discards `SELECT` output, so the built-in
verification at the end of the file is invisible. Check the result yourself with §4.

**Option C — psql, if you have it** (this repo's local Postgres container ships one):

```bash
docker exec -i local-postgres psql "<connection string>" -v ON_ERROR_STOP=1 \
  < prisma/sql/reset-keep-superadmin.sql
```

Keep `-v ON_ERROR_STOP=1`, and do not pipe the output through `head`/`tail` if you care about the exit
code — a pipeline reports the last command's status, not psql's.

### What survives

| Kept | Why it has to be |
|---|---|
| `Role` (4 rows) | `User.roles` is how a login gets its permissions. No roles → no usable account. |
| `Company` (the Super Admin's only) | `User.companyId` is `NOT NULL`. |
| `User` (the Super Admin only) | The only way back in. |
| `UserRole` (that one grant) | Links the two above. |
| `SystemConfiguration` | Allocation weights, run schedule, booking window. Read from the DB at runtime, not env. |
| `OfficeLocation` | **There is no API to create one.** `POST /parking-areas` fails forever with *"No office location is configured"* without it. |
| `ParkingArea` | So there is somewhere to add bays. Structure, not inventory. |
| `NotificationTemplate` | Reference data, looked up by code. |
| `WorkingDayConfiguration` / `Holiday` | Building-wide rows only (Mon–Fri). Company-scoped rows go with their company. |

### What you must rebuild afterwards, in this order

Nothing can be booked or allocated until steps 1–2 are done. All of it is reachable in the UI as the
Super Admin.

1. **Parking slots** — Super Admin → Slots. Until at least one exists, an allocation run throws
   *"Not enough usable parking slots"*.
2. **Companies**, then **a quota per company** — effective **today or earlier**, or it reads as zero. A
   quota cannot exceed the slots from step 1.
3. **Company admins and users** — they register, you approve.

Everyone is signed out: `RefreshToken` is truncated.

### Does the app still run afterwards?

Yes — verified 2026-08-23 by driving the whole recovery path over the real API against a freshly reset
database. Every step returned its success status: log in as the Super Admin → `GET`/`POST
/parking-areas` (the real proof `OfficeLocation` survived, since creating an area is what fails without
one) → create slots → create a company → set a quota effective today → a Company Admin and an employee
register and are approved → `GET /availability` still offers bookable dates (so `SystemConfiguration` and
the building-wide working days survived) → book → run allocation → hand the slot to a colleague.

Two things the reset does **not** change, and both matter:

- **The Super Admin's password is untouched.** Unlike `db:wipe`, this script only deletes rows. Confirm
  you can still log in *before* running it, or you will have deleted every other account and be locked
  out. Recovery is `seed:essentials -- --reset-password` (§1).
- **The office location and parking area survive**, so you are never stranded — `POST /parking-areas` has
  no other way to bootstrap itself.

### If you want it barer still

[`reset-strip-scaffolding.sql`](../backend/prisma/sql/reset-strip-scaffolding.sql) additionally clears
`ParkingArea`, `NotificationTemplate`, `Holiday` and `WorkingDayConfiguration` (keeping one
`OfficeLocation`, creating one if needed). Run it **after** the script above. You will then need
`seed:essentials` to put the working days, templates and parking area back — so most of the time this is
a step backwards, not forwards.

### Rebuilding the baseline non-interactively

`seed:essentials` is idempotent and recreates everything in the "Kept" table above except companies and
users. Useful if a reset went further than intended:

```bash
cd backend
SUPERADMIN_PASSWORD="<min 10 chars, not the dev password>" npm run seed:essentials
```

Add `--reset-password` to overwrite an existing Super Admin's password; without it an existing account is
left alone, so a routine re-run cannot clobber a rotated password.

> **Never `npm run db:seed` on a deployed database.** It is the *development* seed: Assent, TTC,
> Aditi/Rahul/Sara and their cars, all with the publicly-known password `ChangeMe#12345`. It also *fails*
> on any database where `partial-unique.sql` has been applied — it upserts on `User.email`, and Postgres
> will not use the partial index as an `ON CONFLICT` arbiter (`42P10`).

---

## 2 · Apply a pending migration

```bash
cd backend
npx prisma migrate status        # confirm the host and what is pending
npm run db:deploy                # = prisma migrate deploy
```

`migrate deploy` only applies migrations that have not run. It never resets and never prompts.

**Currently pending on Supabase:** `20260823100000_booking_reassignment` — six nullable columns on
`BookingRequest` for the last-minute slot handover. Until it is applied, `POST /bookings/{id}/reassign`
fails in the deployed environment. Additive and nullable, so it needs no downtime and no backfill.

### After any migration that touches unique indexes

`partial-unique.sql` is **not** in the migration chain — Prisma's DSL cannot express partial unique
indexes, so they live in raw SQL that nothing will remind you to run:

```bash
npx prisma db execute --file prisma/partial-unique.sql --schema prisma/schema.prisma
```

Verify all three are present. The reliable check is `seed:essentials`, which queries them itself and
prints a loud warning if any are missing — it is idempotent, so running it purely as a check is fine:

```bash
SUPERADMIN_PASSWORD="<the existing one>" npm run seed:essentials
# → "partial indexes        all 3 present"
```

Otherwise paste this into the Supabase SQL Editor and count the rows:

```sql
SELECT indexname FROM pg_indexes WHERE indexname IN
  ('User_email_active_key','GateEvent_open_visit_key','VehicleRegistrationRequest_pending_key');
```

> ⚠️ **Do not use `npx prisma db execute` to check this.** It discards `SELECT` output and only ever
> prints `Script executed successfully.` — a passing run tells you the query *ran*, not that the indexes
> exist. [`deployment.md`](deployment.md) §2 presents that command as a gate that "returns three rows";
> it cannot. *Verified 2026-08-23.*

Without the indexes: a soft-deleted email blocks re-registration forever, and the gate loses its
double-check-in and duplicate-walk-in backstops.

### Creating a new migration (local only)

```bash
export DATABASE_URL="postgresql://postgres:password123@127.0.0.1:5432/parking_poc"
export DIRECT_URL="$DATABASE_URL"
npm run db:migrate -- --name my_change     # = prisma migrate dev
```

`migrate dev` can **drop and recreate** the database to resolve drift. Never run it against Supabase.

---

## 3 · Local databases

The container is `local-postgres` (Postgres 18) on `127.0.0.1:5432`, user `postgres`, password
`password123`. Start it with `docker start local-postgres`.

### A fresh one from scratch

The most reliable way to get a known-good database, and it exercises the real migration chain rather than
`db push`:

```bash
docker exec local-postgres psql -U postgres -c "CREATE DATABASE parking_scratch;"

cd backend
export DATABASE_URL="postgresql://postgres:password123@127.0.0.1:5432/parking_scratch"
export DIRECT_URL="$DATABASE_URL"
export npm_config_registry=https://registry.npmjs.org/   # the global registry is CodeArtifact; token expires
export NODE_OPTIONS=--use-system-ca                      # corporate TLS breaks the engine download

npx prisma migrate deploy
docker exec -i local-postgres psql -U postgres -d parking_scratch < prisma/partial-unique.sql
npm run db:seed          # dev seed: demo companies, users, slots, quota, vehicles
```

Seeded logins, all password `ChangeMe#12345`:

| Role | Email |
|---|---|
| Super Admin | `superadmin@redbricks.example` |
| Company Admin (Assent) | `admin@assent.example` |
| Users | `aditi@`, `rahul@`, `sara@assent.example` |
| Security / gate | `security@redbricks.example` |

### Wipe a local one back to one Super Admin

```bash
npm run db:wipe -- --yes
```

Local hosts only (see §1). Also resets the Super Admin's password back to `ChangeMe#12345`, which
`db:seed` will not do — it upserts with `update: {}`.

### Drop one

```bash
docker exec local-postgres psql -U postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='parking_scratch';" \
  -c "DROP DATABASE IF EXISTS parking_scratch;"
```

The `pg_terminate_backend` line is not optional — a still-connected app or a leaked Prisma client makes
`DROP DATABASE` fail with *"is being accessed by other users"*.

### The integration-test database

`npm run test:integration` manages its own: `tests/integration/globalSetup.ts` drops and recreates
`parking_poc_test`, runs `prisma db push`, and seeds it — overriding `DATABASE_URL` **and** `DIRECT_URL`
so it can never touch `.env`'s target. It needs the local container running, nothing else.

Because it uses `db push` rather than `migrate deploy`, **a green integration suite does not prove a
hand-written migration works.** Test that separately with a fresh local database (§3).

---

## 4 · Inspect without changing anything

**`npx prisma db execute` cannot read anything** — it discards `SELECT` output and always prints
`Script executed successfully.` regardless of what the query returned. To actually see data, use one of:

- **Supabase SQL Editor** — for the deployed database.
- **`npx prisma studio`** — browser UI over whatever `.env` points at, which is Supabase. Read-only if
  you only click around, but it *can* edit rows.
- **`docker exec local-postgres psql …`** — for local databases.

Row counts, to confirm what §1 left behind:

```sql
SELECT 'User' t, count(*) n FROM "User"
UNION ALL SELECT 'Company', count(*) FROM "Company"
UNION ALL SELECT 'ParkingSlot', count(*) FROM "ParkingSlot"
UNION ALL SELECT 'CompanySlotAllocation', count(*) FROM "CompanySlotAllocation"
UNION ALL SELECT 'BookingRequest', count(*) FROM "BookingRequest"
UNION ALL SELECT 'ParkingAllocation', count(*) FROM "ParkingAllocation"
ORDER BY t;
```

The surviving login:

```sql
SELECT u.email, u.status, c.name AS company, r.name AS role
FROM "User" u
JOIN "Company" c ON c.id = u."companyId"
JOIN "UserRole" ur ON ur."userId" = u.id
JOIN "Role" r ON r.id = ur."roleId";
```

**Deployed database as of 2026-08-23**, for blast-radius context before running §1: 3 users, 5 companies,
13 parking slots, 4 quotas, 3 parking areas, 20 allocation runs, 16 audit rows, 81 refresh tokens, 0
bookings, 19 config rows, all 3 partial indexes present.

---

## 5 · Gotchas

| Symptom | Cause |
|---|---|
| A "local" command changed the deployed data | `.env` points at Supabase. Always §0 first, and override `DIRECT_URL` too. |
| `DIRECT_URL resolved to an empty string` | `export A=... B=$A` in one statement. Use two. |
| `db:wipe` refuses to run | Working as designed — local hosts only. Use §1. |
| Seed dies with `42P10 … ON CONFLICT` | `npm run db:seed` on a database where `partial-unique.sql` has been applied. Use `seed:essentials`. |
| `DROP DATABASE … is being accessed by other users` | Terminate backends first (§3). |
| `npm error … npm login` from any `npx prisma` call | CodeArtifact token expired. `export npm_config_registry=https://registry.npmjs.org/`. |
| `unable to get local issuer certificate` on `prisma generate` | Corporate TLS interception. `export NODE_OPTIONS=--use-system-ca`. |
| Allocation throws *"Not enough usable parking slots"* | No slots exist. A quota alone gives a company nothing to win — add slots first. |
| A company's quota reads as zero | Its effective date is in the future. Quotas must be effective today or earlier. |
| `npm run seed:today` fails | Stale script — `prisma/seed-today.ts` does not exist in the repo. |

---

## Command reference

| Command | Does | Safe on Supabase? |
|---|---|---|
| `npx prisma migrate status` | Names the host, lists pending migrations | ✅ read-only |
| `npm run db:deploy` | Applies pending migrations | ✅ |
| `npm run db:migrate` | Creates a migration; **may drop the DB** | ❌ local only |
| `npm run db:reset` | `migrate reset` — **drops everything** | ❌ local only |
| `npm run db:wipe -- --yes` | Back to one Super Admin | ❌ refuses non-local |
| `prisma db execute --file prisma/sql/reset-keep-superadmin.sql` | Back to one Super Admin | ✅ **this is the §1 answer** |
| `npm run db:seed` | Dev seed with demo cast + public password | ❌ never |
| `npm run seed:essentials` | Minimum viable baseline, password from env | ✅ idempotent |
| `prisma db execute --file prisma/partial-unique.sql` | The 3 partial unique indexes | ✅ idempotent |
| `npm run test:integration` | Uses its own throwaway local DB | ✅ cannot reach `.env`'s target |
| `prisma db execute` (any `SELECT`) | Runs it, shows **nothing** | ✅ but useless for reading |
| `npx prisma studio` | Browser UI over `.env`'s target — **can edit** | ⚠️ that is the live database |

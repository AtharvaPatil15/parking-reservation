# Deployment — Supabase + Render + Vercel

| Layer | Where | What it is |
|---|---|---|
| Database | **Supabase** | Managed PostgreSQL |
| Backend | **Render** (Web Service) | `backend/` — one Node process: the API *and* the allocation scheduler |
| Frontend | **Vercel** | `frontend/` — static Vite build |

One backend service. No worker, no queue, no Redis — `REDIS_URL` in `.env.example` is a placeholder for
a phase that was never built, and `bullmq`/`ioredis` are not dependencies. The allocation scheduler is a
`setInterval` inside the API process
([`allocation.scheduler.ts`](../backend/src/modules/allocation/allocation.scheduler.ts)).

## Order — and why

**Database → Backend → Frontend → back to Backend.**

The last hop is not a mistake. `vercel.json` needs the Render URL, and `CORS_ORIGIN` on Render needs the
Vercel URL. You break the circle by deploying the backend first, pointing the frontend at it, then
returning to set `CORS_ORIGIN`.

## The four things you cannot skip

Everything else in this document is convenience. These four fail *silently* — the app boots, the screens
render, and the damage appears days later.

| # | Skip it | Symptom | Section |
|---|---|---|---|
| 1 | `partial-unique.sql` | Soft-deleted email blocks re-registration forever; gate loses its double-check-in and duplicate-walk-in backstops | §2 |
| 2 | The Vercel rewrite | **Everyone logged out 15 min after signing in** | §4 |
| 3 | Keeping Render awake | Weekly allocation never runs; no slots on Monday | §5 |
| 4 | Keeping Supabase awake | Project pauses after ~7 days idle, needs a manual restore | §6 |

---

## 1 · Supabase

### 1.1 Create it

**Region: Mumbai or Singapore** — and use the same region for Render. The allocation engine runs a
per-user `count` and a per-company quota read inside one `SERIALIZABLE` transaction with a 30-second
timeout ([`allocation.service.ts:303`](../backend/src/modules/allocation/allocation.service.ts#L303)).
Backend and database on different continents turns that into hundreds of round trips and a plausible
timeout.

### 1.2 Turn the Data API off — before migrating

Tables Prisma creates in the `public` schema are **automatically published on Supabase's REST API**, and
Prisma cannot add RLS policies. The moment you run `db:deploy`, all 26 tables are reachable over the
internet — including `User.passwordHash`, `User.address`, `pinCode`, `contactNumber`, every vehicle
plate and every walk-in registration. That is staff home addresses.

Do **both** of these — they are layers, not alternatives:

1. **Project Settings → API → disable the Data API.** This is the real control: no client can reach the
   tables at all. You never use Supabase's client; the React app talks to your own Express backend.
2. **Enable automatic RLS enforcement** (Supabase's one-click event-trigger setup). This is the backstop,
   and it exists for one specific reason: **Prisma creates tables outside the dashboard**, so every future
   migration adds a table with RLS off. If anyone ever re-enables the Data API — a teammate wanting the
   API tab, a later feature, someone following a tutorial — those tables are instantly public. Point 1 is
   a decision made once and forgotten; point 2 keeps holding.

**Neither affects Prisma.** The `postgres` role Prisma connects as *owns* the tables it creates, and
Postgres table owners bypass RLS unless `FORCE ROW LEVEL SECURITY` is set. So RLS with zero policies is a
clean deny-all for `anon`/`authenticated` and invisible to the app. Prisma does not model RLS either, so
it will not show up as schema drift.

> **Caveat for later.** If you ever move the backend to a dedicated non-owner database role — reasonable
> hardening — that role *is* subject to RLS, and every query would silently return nothing. You would need
> `ALTER ROLE app_user BYPASSRLS` or real policies. The symptom (empty results, no errors) is baffling if
> you have forgotten RLS is on.

*(A third option, if you need the Data API for something else: keep the schema out of `public` with
`?schema=parking`. Supabase only exposes `public` by default.)*

### 1.3 Connection strings

Supabase gives you three. You have a **single long-running Node process**, not serverless:

| Variable | Which string |
|---|---|
| `DATABASE_URL` | **Session pooler**, port 5432 — supports prepared statements, IPv4-friendly |
| `DIRECT_URL` | **Direct connection** — migrations need it for advisory locks |

**Avoid the transaction pooler (6543).** It needs `?pgbouncer=true`, which disables Prisma's prepared
statements, and the 30-second allocation transaction would pin a pooled connection for its duration.

Add `&connection_limit=5` to `DATABASE_URL` — one Render instance doesn't need Prisma's default pool.

### 1.4 The one required code change

`prisma migrate` must not go through a pooler. In
[`schema.prisma`](../backend/prisma/schema.prisma):

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")   // ← add
}
```

Commit it — Render builds from Git.

---

## 2 · Migrate and seed — from your laptop

Render's free tier has **no shell**, so this cannot be fixed after deploying. Supabase is publicly
reachable, so run it locally, before the first deploy.

```bash
cd backend
export DATABASE_URL="<supabase session pooler url>"
export DIRECT_URL="<supabase direct url>"
export SUPERADMIN_PASSWORD="<a real password, min 10 chars>"

npm run db:deploy                                                            # 1. schema
npx prisma db execute --file prisma/partial-unique.sql --schema prisma/schema.prisma   # 2. indexes
npm run seed:essentials                                                      # 3. baseline data
```

**All three, in order.**

> **Use `seed:essentials`, not `seed`.** Two reasons, and the second one will bite you.
>
> `npm run seed` is the *development* seed: it creates Assent, TTC, Aditi/Rahul/Sara, their cars and a
> quota, all with the publicly-known password `ChangeMe#12345`. None of that belongs in a deployment.
> `seed:essentials` creates only what the app cannot run without, and takes the super-admin password from
> `SUPERADMIN_PASSWORD` — it refuses to run without one, and refuses the dev password outright.
>
> More importantly, **`npm run seed` cannot run after step 2 at all.** It calls
> `user.upsert({ where: { email } })`, and step 2 drops `User_email_key` in favour of a *partial* index.
> Postgres will not use a partial index as an `ON CONFLICT` arbiter unless the statement repeats its
> predicate, which Prisma does not emit — so the seed dies with `42P10: there is no unique or exclusion
> constraint matching the ON CONFLICT specification`. `seed:essentials` uses `findFirst` + create/update
> precisely so it works either side of step 2.

- **Step 2 is not in the migration chain and nothing will remind you.** Prisma's DSL cannot express
  partial unique indexes, so they live in raw SQL. Skip it and `User_email_key` stays a *full* unique
  index — a soft-deleted email then blocks re-registration forever — and you lose the
  `GateEvent_open_visit_key` and `VehicleRegistrationRequest_pending_key` concurrency backstops.
- **Step 3 is not optional.** Without it there are no roles (no login can hold a permission), no system
  configuration (allocation has no weights or run schedule), and no office location — and there is **no
  API to create an office location**, so `POST /parking-areas` fails forever with *"No office location is
  configured"*. It also creates the parking area and 20 slots, without which
  `runPrimaryAllocation` throws *"Not enough usable parking slots"*. Configure it with
  `SLOT_COUNT`, `PARKING_AREA_NAME`, `BUILDING_NAME` and friends — see the header of
  [`seed-essentials.ts`](../backend/prisma/seed-essentials.ts).
- **`seed:essentials` re-checks step 2 for you** and prints a loud warning if the three partial indexes
  are absent. It is the only point in this flow that naturally sits after migrating, so it is the right
  place to catch it.

**Gate — do not continue until this returns three rows:**

```bash
npx prisma db execute --stdin --schema prisma/schema.prisma <<'SQL'
SELECT indexname FROM pg_indexes
WHERE indexname IN ('User_email_active_key','GateEvent_open_visit_key','VehicleRegistrationRequest_pending_key');
SQL
```

### 2.1 Optional — automate steps 1 and 2

Both are idempotent, so they can go in Render's build command:

```
npm install && npm run build && npm run db:deploy && npx prisma db execute --file prisma/partial-unique.sql --schema prisma/schema.prisma
```

Seed manually regardless — you only want that once.

---

## 3 · Render (backend)

| Field | Value |
|---|---|
| Type | **Web Service**, Node |
| **Root Directory** | `backend` — monorepo, easy to miss |
| Build | `npm install && npm run build` |
| Start | `npm start` |
| Health Check Path | `/health` |
| Region | **same as Supabase** |
| Instances | **1 — do not autoscale** (§5.3) |

`prisma generate` runs automatically via the existing `postinstall` hook.

### Environment variables

```
NODE_ENV=production
DATABASE_URL=<supabase session pooler url, with &connection_limit=5>
DIRECT_URL=<supabase direct url>
JWT_ACCESS_SECRET=<64 hex chars>
JWT_REFRESH_SECRET=<64 hex chars>
LOG_LEVEL=info
```

Leave `CORS_ORIGIN` until §7 — you don't have the Vercel URL yet. **Never set `PORT`**: Render injects
it and `env.PORT` already reads it ([`env.ts:16`](../backend/src/config/env.ts#L16)); overriding it fails
the health check.

Generate each secret **separately**:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Enforced, not advisory — [`env.ts:27-41`](../backend/src/config/env.ts#L27-L41) makes the app **refuse to
boot** in production if either is missing, still the dev default, or under 32 characters.

### Gate

```bash
curl https://<your-api>.onrender.com/health          # process is up

curl -X POST https://<your-api>.onrender.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"superadmin@redbricks.example\",\"password\":\"$SUPERADMIN_PASSWORD\"}"
```

A token back proves the database is reachable *and* the seed landed. A 401 means §2 step 3 didn't run.

---

## 4 · Vercel (frontend)

| Field | Value |
|---|---|
| **Root Directory** | `frontend` |
| Framework | Vite |
| Build | `npm run build` |
| Output | `dist` |

Set **no** `VITE_*` variables. The API client already defaults to the relative `/api/v1`, which is what
the rewrite needs.

### The rewrite — this is what keeps login working

`frontend/vercel.json`:

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://<your-api>.onrender.com/api/:path*" }
  ]
}
```

**Mandatory, not a nicety.** [`auth.controller.ts:13`](../backend/src/modules/auth/auth.controller.ts#L13)
sets the refresh cookie with `sameSite: 'strict'`. `your-app.vercel.app` and `your-api.onrender.com` are
*different sites*, so a browser refuses to send a Strict cookie to the API. `POST /auth/refresh` would
arrive without it, silent refresh would fail, and **every user would be logged out 15 minutes after
signing in** — while login itself appeared to work. You would find it mid-demo.

The rewrite means the browser only ever talks to the Vercel origin: same-site, so the cookie flows, and
CORS disappears. It is also exactly what `VITE_API_PROXY_TARGET` does in local dev.

> Vercel applies a response timeout to proxied requests. The Super Admin's "run allocation now" button
> can be slow on a large band; if it times out in the browser the run still completes server-side —
> check the weekly screen rather than clicking again.

---

## 5 · Keeping Render awake

### 5.1 Why

The scheduler is a `setInterval` **inside the API process**
([`allocation.scheduler.ts:117`](../backend/src/modules/allocation/allocation.scheduler.ts#L117)). Render
free spins down after 15 minutes idle, and a sleeping container has no timer.

Render grants **750 free instance-hours per workspace per month**; a month is ~730. So exactly one
always-awake service fits. Vercel consumes none of that budget, so the arithmetic works — with no room
for a second always-on free service later.

### 5.2 Two cron schedules

UptimeRobot, cron-job.org, or a GitHub Actions workflow:

1. **`GET /health` every 10 minutes** — spin-down is at 15, so 10 leaves margin, and it spares real users
   the ~1 minute cold start
2. **A second entry at 20:05 IST on your run day**, same URL

**The second is the important one.** The scheduler is catch-up capable *within the run day*:
`dueRunInstant()` returns this week's slot once `now` has passed it, and `startAllocationScheduler()`
fires `tick()` immediately on boot. A service woken at 20:07, 22:00 or 23:50 on the run day **runs the
batch on boot with the correct anchor**.

But [`allocation.scheduler.ts:71`](../backend/src/modules/allocation/allocation.scheduler.ts#L71)
requires the run day to still be *today in IST*. Sleep past IST midnight and the week is skipped, with no
error logged anywhere. The 20:05 ping guarantees the process is awake while catch-up still works.

Pinging repeatedly is safe: restarts reset the in-memory guards, but every date goes through
`runPrimaryAllocation`, which returns early on `status === 'COMPLETED'`.

### 5.3 One instance only

Two instances both tick at 20:00 and both enter `runWeeklyAllocation` while the run row still reads
PENDING. The `SERIALIZABLE` transaction and the `(slotId, bookingDate)` unique prevent double allocation,
but you can end up with the run marked FAILED by the loser *while* the winner's allocations are
committed.

---

## 6 · Keeping Supabase awake

`/health` is **liveness only, with no DB dependency** by design
([`app.ts:39`](../backend/src/app.ts#L39)). So the §5 pings keep Render awake but never touch the
database — Supabase would pause underneath a perfectly healthy-looking API, and restoring it is a manual
dashboard action.

**Simplest fix — add a readiness endpoint and point a daily cron at it:**

```ts
// app.ts, next to /health. Readiness, as opposed to the liveness probe above.
app.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});
```

Keep Render's **health check** on `/health` so a database blip does not trigger a restart loop, and point
the **daily cron** at `/ready`. Once a day is plenty — the pause threshold is ~7 days.

*(Alternative: a `pg_cron` job inside Supabase running a trivial query.)*

---

## 7 · Sequence

1. Supabase project, chosen region — **Data API off** (§1.2)
2. `directUrl` in `schema.prisma` (§1.4), commit and push
3. Migrate → `partial-unique.sql` → seed, from your laptop. **Verify the three indexes** (§2)
4. Render Web Service, same region, env vars minus `CORS_ORIGIN` (§3)
5. `curl /health`, then the login curl (§3 gate)
6. `frontend/vercel.json` with the real Render URL, commit and push
7. Vercel project, root `frontend`, deploy (§4)
8. Render → `CORS_ORIGIN=https://<your-app>.vercel.app`, redeploy
9. `curl https://<your-app>.vercel.app/api/v1/health` — proves the rewrite
10. Add `/ready` (§6), then all three cron schedules (§5.2, §6)

## 8 · Verify

- [ ] Log in through the browser at the **Vercel** URL — super admin, with the `SUPERADMIN_PASSWORD` you set in §2
- [ ] **Wait 16 minutes with the tab open, then click something.** Still signed in = the cookie survived and the rewrite is right. Waiting is the only way to catch this
- [ ] Build the building: **parking area → slots → company → quota**. Nothing allocates until all four exist
- [ ] Register a user, approve them, add a car, book, run the allocation manually
- [ ] Leave it overnight; confirm it is awake in the morning

### Test the automatic run without waiting a week

The run schedule lives in the database, not env (D8), so bring it forward:

1. `/admin/config` → set the allocation run day to **today** and the run time to **~5 minutes from now**
2. Wait — the scheduler ticks every 60 seconds
3. `/admin/weekly-run` → the **Last run** card should show the band it decided
4. **Set the schedule back**

Six minutes instead of seven days, and it exercises the whole automatic path: scheduler, band anchoring,
common pool, and the `lastRun` display. Do it at least once, and not on the morning of a demo.

## 9 · Not covered

- **Backups.** Take a manual one from the Supabase dashboard before any demo.
- **Integration tests stay on local Postgres.** `resetTransactional` truncates tables between tests —
  pointed at Supabase it would wipe hosted data, and 119 tests over a network round trip would crawl.
- **`npm run db:wipe` refuses a non-local `DATABASE_URL`** by design. Do not weaken that guard.
- **The seeded super admin** has a publicly known password. Fine for a POC; create a real one before
  anyone else uses this.
- **Ownership transfer.** Deferred. One thing to know when you get to it: Render **cannot** move
  individual services between workspaces — only recreate them, or ask support to move a whole workspace.
  Vercel and Supabase both support self-service transfers.

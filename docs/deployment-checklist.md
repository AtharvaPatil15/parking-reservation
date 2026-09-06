# Deployment checklist — Supabase + Render + Vercel

One-sitting checklist. Tick as you go. The **why** for every step lives in
[`deployment.md`](deployment.md) — this file is just the doing.

**Order: Supabase → Render → Vercel → back to Render.** The last hop is not a mistake:
`vercel.json` needs the Render URL and `CORS_ORIGIN` needs the Vercel URL.

---

## Values to collect as you go

Fill these in — later steps need them.

| | Value |
|---|---|
| Region (Supabase **and** Render must match) | `________________` |
| `DATABASE_URL` (session pooler, port 5432) | `________________` |
| `DIRECT_URL` (direct connection) | `________________` |
| `JWT_ACCESS_SECRET` | `________________` |
| `JWT_REFRESH_SECRET` | `________________` |
| Render URL | `https://________.onrender.com` |
| Vercel URL | `https://________.vercel.app` |

Generate the two secrets now, **separately** — the app refuses to boot in production if either is
missing, still the dev default, or under 32 characters:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 1 · Supabase

- [ ] Create the project. **Region: Mumbai or Singapore** — write it down, Render must match
- [ ] **Project Settings → API → disable the Data API.** Do this *before* migrating — otherwise all 26
      tables, including `passwordHash` and staff home addresses, are published on the public internet
- [ ] **Enable automatic RLS enforcement** (one-click, in the dashboard). Belt to the above braces:
      Prisma creates tables outside the dashboard, so future migrations arrive with RLS off and would be
      exposed if anyone ever re-enables the API. Does not affect Prisma — the `postgres` role owns the
      tables and owners bypass RLS
- [ ] Copy the **session pooler** string (port 5432) → `DATABASE_URL`, and append `&connection_limit=5`
- [ ] Copy the **direct connection** string → `DIRECT_URL`
- [ ] Do **not** use the transaction pooler (port 6543)

## 2 · One code change

- [ ] In [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma), add `directUrl`:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

- [ ] Commit and push — Render builds from Git

## 3 · Migrate and seed, from your laptop

Render's free tier has no shell, so this cannot be fixed after deploying.

```bash
cd backend
export DATABASE_URL="<session pooler url>"
export DIRECT_URL="<direct url>"
export SUPERADMIN_PASSWORD="<a real password, min 10 chars>"

npm run db:deploy
npx prisma db execute --file prisma/partial-unique.sql --schema prisma/schema.prisma
npm run seed:essentials
```

- [ ] All three ran, in that order

> **`seed:essentials`, never `seed`.** `npm run seed` is the development seed — demo companies, demo
> users, the public password `ChangeMe#12345`. It also **cannot run after the second command**: it upserts
> on `User.email`, and `partial-unique.sql` replaces that index with a partial one, which Postgres will
> not accept as an `ON CONFLICT` arbiter (`42P10`). `seed:essentials` works either side of it.
>
> It prints the parking area and slot count it created, and re-checks the three indexes for you.

**GATE — must return three rows. Do not continue otherwise:**

```bash
npx prisma db execute --stdin --schema prisma/schema.prisma <<'SQL'
SELECT indexname FROM pg_indexes
WHERE indexname IN ('User_email_active_key','GateEvent_open_visit_key','VehicleRegistrationRequest_pending_key');
SQL
```

- [ ] Three rows

## 4 · Render — backend

- [ ] New **Web Service**, Node

| Field | Value |
|---|---|
| **Root Directory** | `backend` |
| Build | `npm install && npm run build` |
| Start | `npm start` |
| Health Check Path | `/health` |
| Region | same as Supabase |
| Instances | **1 — do not autoscale** |

- [ ] Environment variables:

```
NODE_ENV=production
DATABASE_URL=<session pooler url, with &connection_limit=5>
DIRECT_URL=<direct url>
JWT_ACCESS_SECRET=<64 hex chars>
JWT_REFRESH_SECRET=<64 hex chars>
LOG_LEVEL=info
```

- [ ] `CORS_ORIGIN` left unset for now — you don't have the Vercel URL yet
- [ ] **`PORT` not set** — Render injects it; overriding it fails the health check
- [ ] Deployed, note the URL

**GATE — `/health` only proves the process booted. The second call proves Supabase is reachable *and*
the seed landed:**

```bash
curl https://<your-api>.onrender.com/health

curl -X POST https://<your-api>.onrender.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"superadmin\",\"password\":\"$SUPERADMIN_PASSWORD\"}"
```

- [ ] `{"status":"ok"}`
- [ ] A token back (a 401 means the seed did not run — go back to §3)

## 5 · Vercel — frontend

- [ ] Create `frontend/vercel.json` with the **real** Render URL, commit and push:

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://<your-api>.onrender.com/api/:path*" }
  ]
}
```

- [ ] Import the repo

| Field | Value |
|---|---|
| **Root Directory** | `frontend` |
| Framework | Vite |
| Build | `npm run build` |
| Output | `dist` |

- [ ] **No `VITE_*` variables set** — the client already defaults to relative `/api/v1`, which is what
      the rewrite needs
- [ ] Deployed, note the URL

## 6 · Back to Render

- [ ] `CORS_ORIGIN=https://<your-app>.vercel.app`
- [ ] Redeploy

**GATE — through Vercel, not the Render URL. This is what proves the rewrite works:**

```bash
curl https://<your-app>.vercel.app/api/v1/health
```

- [ ] `{"status":"ok"}`

## 7 · Readiness endpoint

`/health` deliberately has no database dependency, so it will not stop Supabase pausing.

- [ ] Add to `backend/src/app.ts`, next to `/health`:

```ts
app.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});
```

- [ ] Commit, push, redeploy

## 8 · Three cron schedules

UptimeRobot, cron-job.org, or a GitHub Actions workflow.

| # | Target | Frequency | Stops |
|---|---|---|---|
| 1 | `/health` | every **10 min** | Render spinning down (15 min idle) |
| 2 | `/health` | **20:05 IST on your run day** | A missed weekly allocation |
| 3 | `/ready` | **once a day** | Supabase pausing (~7 days idle) |

- [ ] All three created

> **#2 is the one people skip.** The scheduler catches up if woken *any time on the run day*, but not
> after IST midnight — and a missed week logs no error anywhere.

## 9 · Verify

- [ ] Log in through the **Vercel** URL — `SUPERADMIN_USERNAME` / the `SUPERADMIN_PASSWORD` you set in §3
- [ ] **Wait 16 minutes with the tab open, then click something.** Still signed in = the cookie survived
      and the rewrite is correct. Waiting is the only way to catch this
- [ ] Build the building, in this order: **parking area → slots → company → quota**. Nothing allocates
      until all four exist
- [ ] Register a user → approve → add a car → book → run the allocation manually
- [ ] Next morning: still awake

## 10 · Test the automatic run — six minutes, not seven days

The run schedule is in the database, not env.

- [ ] `/admin/config` → allocation run day = **today**, run time = **~5 minutes from now**
- [ ] Wait (the scheduler ticks every 60 seconds)
- [ ] `/admin/weekly-run` → the **Last run** card shows the band it decided
- [ ] **Set the schedule back**

Not on the morning of a demo.

---

## If something is wrong

| Symptom | Cause |
|---|---|
| App won't boot, log mentions a secret | A JWT secret is missing, the dev default, or < 32 chars |
| Health check fails on Render | `PORT` was set manually — remove it |
| Login works, then logged out ~15 min later | The Vercel rewrite is missing or points at the wrong URL |
| Login returns 401 with the seeded password | `npm run seed` never ran |
| `POST /parking-areas` → *"No office location is configured"* | Same — the seed never ran |
| A user cannot re-register after being removed | `partial-unique.sql` never ran (§3) |
| Monday with no allocations | Cron #2 missing, or the service slept past IST midnight |
| Everything 500s after a quiet week | Supabase paused — cron #3 missing. Restore from the dashboard |

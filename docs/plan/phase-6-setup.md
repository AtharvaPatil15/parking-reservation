# Phase 6 — Local Setup & Deployment

**Goal:** one-command local run + a repeatable demo. Full spec:
[`../phases-3-6-plan.md`](../phases-3-6-plan.md#phase-6--local-setup--deployment).

**Owner:** Devashish (+ shared). **Entry criteria:** backend + frontend buildable.

---

## Tasks

#### P6-01 · Dockerfiles · Owner: Devashish · Tag: DEMO · Deps: P4-01,P5-01
- **AC:** `backend/Dockerfile` and `frontend/Dockerfile` build clean images.
- **Evidence:** `backend/Dockerfile`, `frontend/Dockerfile`.
- **Status:** ☐

#### P6-02 · docker-compose · Owner: Devashish · Tag: DEMO · Deps: P6-01,P4-03
Services `postgres`, `redis`, `backend`, `frontend`; healthchecks; backend waits for DB then auto-migrate + seed on first boot.
- **AC:** `docker compose up` brings all four up; backend reachable `:4000`, frontend `:5173`; DB seeded automatically.
- **Evidence:** `docker-compose.yml`.
- **Status:** ☐

#### P6-03 · Env examples · Owner: Devashish · Tag: DEMO · Deps: P4-01,P5-01
- **AC:** `backend/.env.example` (DB/Redis/JWT/TTLs/CORS/log) + `frontend/.env.example` (`VITE_API_BASE_URL`); every var documented.
- **Evidence:** `backend/.env.example`, `frontend/.env.example`.
- **Status:** ☐

#### P6-04 · Migrate/seed scripts + partial-unique SQL · Owner: Devashish · Tag: DEMO · Deps: P4-03
- **AC:** documented commands: `prisma migrate dev`, apply `backend/prisma/partial-unique.sql`, `prisma db seed`; `backend/package.json` `prisma.seed` points to `prisma/seed.ts` (resolved from `backend/`).
- **Evidence:** `package.json` (`prisma.seed`), `backend/prisma/partial-unique.sql`.
- **Status:** ☐

#### P6-05 · README + seeded credentials · Owner: Devashish · Tag: DEMO · Deps: P6-02
- **AC:** README covers architecture, prerequisites, `docker compose up`, seeded logins (Redbricks SA / Assent CA / sample users), and dev/test/build commands.
- **Evidence:** `README.md`.
- **Status:** ☐

#### P6-06 · Demo script (golden path) · Owner: Devashish (+ team) · Tag: DEMO · Deps: P5-13,P4-19
Step-by-step: login → submit two bookings → run primary allocation → show ranked breakdown → (if time) release → promotion.
- **AC:** a written script that a presenter can follow verbatim on 30 Jul; matches seeded data.
- **Evidence:** `docs/demo-script.md`.
- **Status:** ☐

#### P6-07 · Deployment recommendations · Owner: Devashish · Tag: Later · Deps: —
- **AC:** doc covering containerized dev/test/staging/prod, managed Postgres+Redis, CI migrations, secrets manager, health checks, single-scheduler note.
- **Evidence:** `docs/deployment.md`.
- **Status:** ⊘

## Phase Definition of Done
`docker compose up` yields a running, seeded app reachable in the browser; README + demo script let anyone
reproduce the hero flow. Deployment doc is Later.

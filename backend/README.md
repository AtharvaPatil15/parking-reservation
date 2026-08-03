# backend — Parking POC API

Express + TypeScript + Prisma. Contract: [`openapi.yaml`](openapi.yaml). Schema: [`prisma/schema.prisma`](prisma/schema.prisma).

## Setup
```bash
cd backend
npm install
cp .env.example .env          # set DATABASE_URL (container password) + secrets
npm run prisma:generate       # generate Prisma client (also runs on postinstall + prebuild)
npm run db:migrate            # create schema (prisma migrate dev)  — or: db/create-schema.js
psql "$DATABASE_URL" -f prisma/partial-unique.sql      # F7 partial-unique index
npm run db:seed               # roles, Redbricks+SA, Assent+CA, users, slots, quota, config, templates
npm run dev                   # http://localhost:4000
```

> **Why the schema lives here and not at the repo root.** Prisma resolves the `prisma` /
> `@prisma/client` packages using the **schema's own directory** as the module-resolution base. While
> the schema sat at `<repo>/prisma/`, that lookup walked *up* past the repo root and never saw
> `backend/node_modules`, so Prisma fell back to the repo root as its "project root", found no
> `package.json`, and tried to `npm i prisma -D` into it. That either failed outright or created a
> phantom root `package.json` + `node_modules` holding a **second, unused client** — leaving
> `backend/node_modules/.prisma/client` stale, so the build reported models missing (`prisma.vehicle`,
> `Prisma.GateEventWhereInput`) that were plainly in the schema. Keeping the schema inside `backend/`
> makes `backend/` the inferred project root, so generate needs no config at all and always refreshes
> the one client the backend compiles against. `postinstall` + `prebuild` regenerate it so a branch
> switch that adds a model can't leave a stale client behind.

## What exists so far (P4-01…P4-04)
- **Scaffold** — `src/app.ts`, `src/server.ts`, layered layout (`config/ lib/ middleware/ modules/`). `GET /health` → 200.
- **Prisma wiring** — `src/lib/prisma.ts` singleton; `package.json > prisma` points at the root schema + `tsx` seed.
- **Cross-cutting middleware** — response/error envelope (§3.2), `AppError` codes, `X-Correlation-Id`,
  zod `validate()`, central error handler, pino logger with **PII masking** (F12).
- **Config module (D8)** — `GET /api/v1/config`, `PATCH /api/v1/config` with time-order + range validation;
  cached `SystemConfiguration` accessor (`src/config/systemConfig.ts`) that scheduler/allocation will read.

> Auth (P4-05) and RBAC/tenant scoping (P4-06) are not wired yet — `/config` routes carry a `TODO(P4-06)`
> to add `requireRole('SUPER_ADMIN')`. Until then treat the API as unprotected (local dev only).

## Scripts
`dev` (tsx watch) · `build` / `start` · `typecheck` · `prisma:generate` · `db:migrate` · `db:deploy` ·
`db:seed` · `db:reset`.

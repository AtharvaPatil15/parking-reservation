# Phases 3–6 — Detailed Implementation Specification

Builds on Phase 1/2 ([`phase-1-requirements-architecture.md`](phase-1-requirements-architecture.md),
[`phase-2-database-design.md`](phase-2-database-design.md)), [`decisions.md`](decisions.md), and
[`notification-service-plan.md`](notification-service-plan.md). Team split + schedule:
[`implementation-plan.md`](implementation-plan.md).

**Stack (locked):** React + TS + **Tailwind** (Vite) · Node/Express + TS · PostgreSQL + Prisma · Redis +
BullMQ · JWT (+ refresh rotation, rotation deferred for the demo).

**How to read the tags:**
- **[DEMO]** — in the 30 Jul evening hero-flow prototype.
- **[MVP]** — in the full first version, right after the demo.
- **[Later]** — subsequent iteration.

---

# Phase 3 — API Design

Contract-first: this is authored and **frozen at M0** as `backend/openapi.yaml`, then all three tracks build
against it in parallel.

## 3.1 Conventions
| Aspect | Rule |
|--------|------|
| Base URL | `/api/v1` |
| Format | JSON request/response; `Content-Type: application/json` |
| Timestamps | ISO-8601 UTC in payloads; business times shown in IST in the UI |
| Dates | booking/quota dates are calendar dates `YYYY-MM-DD` |
| Auth | access **JWT** in `Authorization: Bearer <token>`; refresh token in HTTP-only cookie (rotation — [MVP]) |
| Pagination | `?page=1&pageSize=20` (defaults 1/20, max 100) |
| Sorting/filtering | `?sort=<field>&order=asc|desc` + resource-specific filters |
| Correlation | every response carries `X-Correlation-Id`; echoed into `AuditLog` |
| Versioning | path-based (`/v1`) |

## 3.2 Standard response & error envelope
**Success**
```jsonc
{ "success": true, "data": { /* resource or list */ },
  "meta": { "page": 1, "pageSize": 20, "total": 57 } }   // meta only on list endpoints
```
**Error**
```jsonc
{ "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed",
             "details": [ { "field": "distanceKm", "message": "must be between 0 and 200" } ] } }
```
**Error codes → HTTP status**
| Code | HTTP | Meaning |
|------|------|---------|
| `VALIDATION_ERROR` | 400 | Body/query failed validation |
| `UNAUTHENTICATED` | 401 | Missing/invalid/expired access token |
| `FORBIDDEN` | 403 | Role or tenant scope violation |
| `NOT_FOUND` | 404 | Resource absent or not visible to tenant |
| `CONFLICT` | 409 | Duplicate (e.g. second booking same user/date/type; slot already taken) |
| `WINDOW_CLOSED` | 422 | Action attempted outside its time window (e.g. booking after cutoff) |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL` | 500 | Unhandled server error |

## 3.3 Authorization model
- **Roles:** `SUPER_ADMIN`, `COMPANY_ADMIN`, `USER`.
- **Tenant scoping:** every `COMPANY_ADMIN`/`USER` request is filtered by the caller's `companyId`.
  Cross-company reads/writes → `403 FORBIDDEN` (except explicitly-allowed common-pool inventory).
- Enforced by two middlewares: `requireRole(...roles)` and `scopeToTenant()` (injects a `companyId` filter
  into the repository call).

## 3.4 Endpoint specifications
Legend: **R** = required role. `SA`=SUPER_ADMIN, `CA`=COMPANY_ADMIN, `U`=USER, `—`=public.

### Auth
| Method & path | R | Purpose | Tag |
|---|---|---|---|
| `POST /auth/register` | — | Create a `PENDING` user under an active company | **[DEMO]** (P4-20, Prithviraj) |
| `POST /auth/verify-email` | — | Confirm email token | [MVP] |
| `POST /auth/login` | — | Issue access + refresh | **[DEMO]** |
| `POST /auth/refresh` | — | Rotate refresh, issue new access | [MVP] |
| `POST /auth/logout` | any | Revoke refresh | [MVP] |
| `POST /auth/forgot-password` · `/reset-password` · `/change-password` | —/self | Password lifecycle | [Later] |

**`POST /auth/login`** — hero endpoint
```jsonc
// request
{ "email": "aditi", "password": "ChangeMe#12345" }
// 200
{ "success": true, "data": {
    "accessToken": "eyJ…", "tokenType": "Bearer", "expiresIn": 900,
    "user": { "id": "…", "fullName": "Aditi Rao", "role": "USER", "companyId": "…", "companyName": "Assent" } } }
// refresh token set as HttpOnly cookie (rotation [MVP])
```
Validation: `email` valid + present, `password` present. Errors: `401 UNAUTHENTICATED` on bad creds;
`403 FORBIDDEN` if user `status != ACTIVE`.

### User (self)
| Method & path | R | Purpose | Tag |
|---|---|---|---|
| `GET /me` | any | Current profile | **[DEMO]** |
| `PATCH /me` | any | Update profile incl. **`distanceKm`** | **[DEMO]** |
| `GET /me/bookings` | U | Own booking history (paged) | **[DEMO]** |
| `GET /me/notifications` · `PATCH /notifications/:id/read` | any | In-app inbox | [MVP] |

### Companies *(SA)*
`POST /companies` · `GET /companies` · `GET /companies/:id` · `PATCH /companies/:id` ·
`PATCH /companies/:id/status` — company CRUD + activate/deactivate. `GET /companies` also feeds the
registration dropdown (public subset: id + name of active companies). **[MVP]** (seed-driven for the demo).

### Company Users
| Method & path | R | Purpose | Tag |
|---|---|---|---|
| `GET /companies/:id/users` | SA/CA(own) | List company users (filter `?status=`) | [MVP] |
| `PATCH /users/:id/approval` | CA(own) | `{ "decision": "APPROVE" \| "REJECT" }` → sets `ACTIVE`/`REJECTED` | [MVP] |
| `PATCH /users/:id/status` | SA/CA(own) | Activate/deactivate | [MVP] |
| `POST /companies/:id/admins` | SA | Assign a user as Company Admin | [MVP] |

### Slots & Quota *(SA)*
| Method & path | Purpose | Tag |
|---|---|---|
| `POST /slots` · `GET /slots` · `PATCH /slots/:id` | Physical slot CRUD (type/status/EV/accessible) | [MVP] |
| `POST /companies/:id/quota` | Set **effective-dated** quota `{ slotCount, effectiveFrom, effectiveTo? }` | **[DEMO]** (via seed or a simple screen) |
| `GET /companies/:id/quota` | Current + future quota rows | [MVP] |

### Blocking *(SA any company · CA own company · never USER)*
`POST /companies/:id/blocks` `{ blockedCount, startDate, endDate, reason, reasonText? }` ·
`GET /companies/:id/blocks` · `DELETE /blocks/:id`. Authorization: `SUPER_ADMIN` may block for any company;
`COMPANY_ADMIN` only for their own (tenant-scoped); `USER` is forbidden. Blocked count is excluded from
allocation + common pool. **[MVP]**

### Bookings *(U, own)*
| Method & path | Purpose | Tag |
|---|---|---|
| `POST /bookings` | Submit a request for the next bookable weekday | **[DEMO]** |
| `PATCH /bookings/:id` | Edit before cutoff | [MVP] |
| `POST /bookings/:id/cancel` | Cancel before cutoff | [MVP] |
| `POST /bookings/:id/release` | Release an allocated slot | [MVP] (demo if time) |
| `GET /bookings/:id` | Status + allocated slot + score breakdown | **[DEMO]** |
| `POST /bookings/common-pool` | Join the common-pool window | [Later] |

**`POST /bookings`** — hero endpoint
```jsonc
// request
{ "bookingDate": "2026-07-31",
  "vehicleType": "CAR", "vehicleNumber": "MH12AB1234",
  "carpoolPeople": 3,                     // includes the driver (1–4)
  "specialRequirement": null,
  "carpoolMembers": [                     // only same-company employees are scored (F4)
    { "name": "Rahul Mehta", "employeeEmail": "rahul" },
    { "name": "Neighbour",   "employeeEmail": null } ] }
// 201
{ "success": true, "data": {
    "id": "bkg_…", "status": "SUBMITTED", "bookingType": "PRIMARY",
    "bookingDate": "2026-07-31", "travelDistanceKm": 12.4, "carpoolPeople": 3,
    "submittedAt": "2026-07-30T11:20:00Z" } }
```
Validation: `bookingDate` must be a bookable weekday (Mon–Fri, D7) and `now < booking.primaryCutoff`
(else `422 WINDOW_CLOSED`); `carpoolPeople` 1–`carpool.maxPeople`; `travelDistanceKm` snapshotted from the
user's profile at submission (F6). Duplicate same-type request for the date → `409 CONFLICT`.

### Allocation *(SA)*
| Method & path | Purpose | Tag |
|---|---|---|
| `POST /allocation/primary/run` | `{ "bookingDate": "2026-07-31" }` → run primary allocation (idempotent) | **[DEMO]** |
| `GET /allocation/runs/:id` | Run status + summary (allocated/waitlisted counts) | **[DEMO]** |
| `GET /allocation/runs/:id/breakdown` | Per-user score breakdown + rank | **[DEMO]** |
| `POST /allocation/common-pool/run` | Run common-pool allocation | [Later] |
| `POST /allocation/override` | Manual override of one allocation | [MVP] |

**`GET /allocation/runs/:id/breakdown`** — explains every outcome
```jsonc
{ "success": true, "data": {
  "runId": "run_…", "bookingDate": "2026-07-31", "status": "COMPLETED",
  "results": [
    { "rank": 1, "user": "Sara Khan", "distanceKm": 38.1, "people": 3,
      "distanceScore": 95.25, "carpoolScore": 66.67, "finalScore": 84.1,
      "outcome": "ALLOCATED", "slotNumber": "B1-01" },
    { "rank": 2, "user": "Aditi Rao", "distanceKm": 12.4, "people": 3,
      "distanceScore": 31.0, "carpoolScore": 66.67, "finalScore": 45.27,
      "outcome": "WAITLISTED", "slotNumber": null } ] } }
```

### Config *(SA)* — D8
| Method & path | Purpose | Tag |
|---|---|---|
| `GET /config` | All `SystemConfiguration` entries | **[DEMO]** |
| `PATCH /config` | Update timings/weights `{ "booking.primaryCutoff": "18:30", … }` | **[DEMO]** |

`PATCH /config` validates time ordering (`primaryCutoff < primaryResultsBy ≤ commonPoolClose <
commonPoolResultsBy`) and numeric ranges; on success the scheduler reschedules. Every change audited.

### Dashboards
`GET /dashboard/super-admin` · `GET /dashboard/company-admin` · `GET /dashboard/user` — pre-aggregated
counts for each role's home screen. **[DEMO]** (minimal counts).

### Reports
`GET /reports/:type` (+ filters) · `GET /reports/:type/export` (CSV, async). **[Later]**

## 3.5 Deliverable
`backend/openapi.yaml` (OpenAPI 3.0.3 — chosen for broad codegen/IDE tooling support) covering every endpoint above, with schemas for all request/response
bodies. It drives (a) backend request validation, (b) the frontend MSW mock server, and (c) a generated typed
API client for the frontend.

---

# Phase 4 — Backend

## 4.1 Architecture
Clean layering, dependencies point inward:
`routes → controllers → services (domain logic) → repositories (Prisma) → PostgreSQL`.
Cross-cutting middleware: auth (JWT verify), `requireRole`, `scopeToTenant`, zod validation, error handler,
request logger (PII-masked), audit interceptor. Background work runs in BullMQ workers sharing the service
layer.

## 4.2 Folder structure
```
backend/
  src/
    config/            # env loader, SystemConfiguration accessor (cached)
    middleware/        # auth, rbac, tenantScope, validate(zod), errorHandler, correlationId
    modules/
      auth/            # controller, service, routes, dtos
      companies/
      users/           # company-user management
      slots/           # slots + quota + blocks
      bookings/
      allocation/      # engine (pure) + service (db/txn) + run state machine
      notifications/   # dispatch + templates (in-app now, email later)
      config/          # SystemConfiguration CRUD + validation
      dashboards/
      audit/
    jobs/              # BullMQ queues + workers + scheduler (config-driven)
    lib/               # prisma client, logger, response helpers, errors
    app.ts             # express app wiring
    server.ts          # http bootstrap
  prisma/              # symlink/ref to root prisma (schema + seed)
  tests/               # unit + integration
  openapi.yaml
  Dockerfile
  .env.example
```

## 4.3 Configuration & environment (`.env.example`)
`DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ACCESS_TOKEN_TTL=900`,
`REFRESH_TOKEN_TTL=604800`, `PORT=4000`, `NODE_ENV`, `CORS_ORIGIN`, `LOG_LEVEL`, and (later)
`EMAIL_PROVIDER`, `EMAIL_FROM`, provider creds. Timings/weights are **not** env — they live in
`SystemConfiguration` (D8), read through a small cached accessor that invalidates on `PATCH /config`.

## 4.4 Modules
| Module | Responsibility | Tag |
|--------|----------------|-----|
| **Auth** | login + JWT issue/verify; register/verify/refresh-rotation/logout/password; Argon2id hashing | login + register **[DEMO]** (register = P4-20), rest [MVP] |
| **RBAC + tenant** | `requireRole`, `scopeToTenant` | **[DEMO]** |
| **Companies** | CRUD + status; active-company list for registration | [MVP] |
| **Users** (company) | list, approval, activate/deactivate, admin assignment | [MVP] |
| **Slots & Quota** | slot CRUD; effective-dated `CompanySlotAllocation`; `SlotBlock` | quota **[DEMO]**, rest [MVP] |
| **Bookings** | create/edit/cancel/release; distance snapshot; carpool members + dedupe | create/status **[DEMO]** |
| **Allocation** | scoring engine + DB assignment (see 4.5) | **[DEMO]** |
| **Scheduler** | config-driven BullMQ jobs + manual triggers (see 4.6) | manual **[DEMO]** |
| **Notifications** | in-app dispatch per plan; email [Later] | in-app [MVP] |
| **Config** | `SystemConfiguration` read/update + validation | **[DEMO]** |
| **Audit** | write `AuditLog` on key mutations | [MVP] |
| **Dashboards** | aggregate counts per role | **[DEMO]** minimal |
| **Reports** | queries + CSV export (async) | [Later] |

## 4.5 Allocation service — detailed algorithm
Two parts: a **pure, unit-tested scoring function** (no DB) and a **transactional assignment service**.

**Scoring (pure) — per booking**
```
distanceScore = (min(distanceKm, maxDistanceKm) / maxDistanceKm) * 100     // maxDistanceKm=40
people        = 1 (driver) + count(scored carpool members)                 // scored = same-company employees
carpoolScore  = ((min(people, maxPeople) - 1) / (maxPeople - 1)) * 100      // maxPeople=4
finalScore    = distanceWeight*distanceScore + carpoolWeight*carpoolScore   // 0.60 / 0.40
```

**Primary allocation run (transactional)**
```
1. Guard idempotency: upsert AllocationRun(runType=PRIMARY, bookingDate); if COMPLETED → return cached.
   Set status=RUNNING, attemptCount++.
2. BEGIN TRANSACTION (SERIALIZABLE).
3. Load SUBMITTED PRIMARY bookings for bookingDate. Compute finalScore + breakdown for each.
4. Group by company. For each company, compute available quota:
      available = effectiveQuota(company, bookingDate) - blockedCount(company, bookingDate)
5. Rank that company's bookings by finalScore desc, applying tie-breakers:
      (1) more people  (2) greater distance  (3) earlier submittedAt
      (4) fewer allocations in previous 30 days  (5) secure random draw
6. Lock candidate slots: SELECT … FOR UPDATE. Assign top `available` bookings to concrete ParkingSlots:
      INSERT ParkingAllocation (unique (slotId,bookingDate) + unique bookingRequestId = DB backstop).
      Set booking.status=ALLOCATED, allocationScore, allocationTime.
7. Remaining bookings → status=WAITLISTED.
8. Persist AllocationScoreBreakdown for every booking (allocated + waitlisted).
9. COMMIT. Set AllocationRun.status=COMPLETED, completedAt.
10. Enqueue notifications (PRIMARY_SLOT_ALLOCATED / _NOT_ALLOCATED).
   On any error → ROLLBACK, status=FAILED, error captured; safe to re-run (idempotent).
```

**Release → reallocation (post-primary, F3)**
```
On release of an allocated slot for bookingDate:
  candidate = highest-finalScore WAITLISTED booking in the SAME company for that date
  if candidate: reassign slot to candidate (txn), notify; audit
  else: (common-pool path — [Later]) move slot to CommonPoolSlot inventory
```

## 4.6 Scheduler jobs (BullMQ, config-driven — D8)
| Job | Trigger (from `SystemConfiguration`) | Action | Idempotent |
|-----|--------------------------------------|--------|-----------|
| Close primary window | `booking.primaryCutoff` | Mark late requests EXPIRED | yes |
| Run primary allocation | between cutoff and `primaryResultsBy` | Invoke allocation service | yes (AllocationRun) |
| Publish + build common pool | `booking.primaryResultsBy` | Publish results; derive `CommonPoolSlot` | yes |
| Close common-pool window | `booking.commonPoolClose` | Freeze common-pool requests | yes ([Later]) |
| Run common-pool allocation | `booking.commonPoolResultsBy` | Common-pool allocation | yes ([Later]) |
| Reminder | `booking.reminderBefore` before cutoff | Notify users with no submission | yes |
| Cleanup | nightly | Expire tokens/temp records | yes |
Jobs read the current config on each tick and reschedule when it changes; all are retryable with backoff and
protected against duplicate execution. For the demo, allocation is also exposed as a **manual endpoint**.

## 4.7 Security, errors, logging
Argon2id passwords; JWT verify; RBAC + tenant scope on every route; zod validation; Prisma parameterized
queries (SQLi-safe); helmet secure headers; rate limiting on auth; central error handler mapping domain
errors → the envelope in §3.2; structured logs with **PII masking** (email/contact/address) + correlation id;
`AuditLog` on all key mutations.

## 4.8 Testing
- **Unit (Jest):** the scoring function (exhaustive: distance bands, carpool 1–4, weights, ties), config
  validation, auth token logic. *Written first.*
- **Integration (Supertest + throwaway Postgres):** login; `POST /bookings` → `POST /allocation/primary/run`
  → `GET …/breakdown` happy path; concurrency test that two runs can't double-assign a slot; tenant-isolation
  negative tests (Company A cannot read Company B).

---

# Phase 5 — Frontend

## 5.1 Stack & structure
Vite + React + TS + **Tailwind** (optional shadcn/ui for base components). React Query (server state) +
react-hook-form + zod (forms). MSW for mock-first dev against `openapi.yaml`.
```
frontend/
  src/
    app/            # router, providers (QueryClient), auth context
    api/            # generated typed client + hooks (useLogin, useCreateBooking, useRunAllocation…)
    components/     # Button, Input, Select, Card, Table, Badge, Modal, Toast, StateViews
    features/
      auth/         # LoginPage, RegisterPage
      superadmin/   # Dashboard, Companies, Slots, Quota, ConfigTimings, AllocationRun+Breakdown
      companyadmin/ # Dashboard, UserApprovals, Blocks
      user/         # Dashboard, BookingForm, BookingStatus, History
    lib/            # formatters (IST), guards, constants
    mocks/          # MSW handlers
    test/           # RTL setup
```

## 5.2 Routing & guards
Public: `/login`, `/register`. Authenticated shell with role guards:
- `SUPER_ADMIN` → `/admin/*`  · `COMPANY_ADMIN` → `/company/*`  · `USER` → `/app/*`.
- A `<RequireRole>` wrapper redirects unauthorized users; unauthenticated → `/login`.

## 5.3 Design system (Tailwind)
Define tokens in `tailwind.config` (brand colors, spacing, radius, shadow) + light/dark support. Base
components (Button, Input, Select, Card, Table, Badge, Modal, Toast, and the four **state views** below) built
once and reused. Accessible (labels, focus rings, keyboard nav), responsive (mobile→desktop).

## 5.4 Screens
Each screen ships all four UX states: **loading / empty / error / success**.

**User** *(hero)*
- **BookingForm [DEMO]** — pick date (constrained to bookable weekdays), vehicle, **carpool people (1–4)**,
  optional carpool member emails, special requirement. Shows the user's `distanceKm` (editable via profile).
  Client validation mirrors the API; disables submit after cutoff with a countdown.
- **BookingStatus [DEMO]** — current request status (SUBMITTED/ALLOCATED/WAITLISTED/…), allocated slot number,
  and the **score breakdown** (distance/carpool/final) so the user sees *why*. Release button [MVP].
- **History [MVP]** — past bookings, paged.
- **Dashboard [DEMO]** — upcoming booking, status, cutoff countdown.

**Super Admin**
- **AllocationRun + Breakdown [DEMO]** — pick a date, **"Run primary allocation"** button, then a ranked
  table (rank, user, distance, people, scores, outcome, slot) — the centerpiece of the demo.
- **ConfigTimings [DEMO]** — edit all window times + weights (D8) with inline validation.
- **Dashboard [DEMO]** — totals: slots, companies, allocated/waitlisted, utilization.
- **Companies / Slots / Quota [MVP]** — management screens (seed-driven for the demo).

**Company Admin**
- **UserApprovals [MVP]** — approve/reject pending users. **Blocks [MVP]** — block a quota count with reason.
- **Dashboard [MVP]** — company quota/allocated/blocked/waitlisted.

## 5.5 API integration, state, forms
Typed client generated from `openapi.yaml`; React Query hooks per endpoint with cache invalidation (e.g.
running allocation invalidates breakdown + dashboards). Forms use react-hook-form + zod schemas shared in
spirit with the backend. Auth token in memory + refresh via cookie ([MVP]); Axios/fetch interceptor attaches
`Authorization` and handles 401.

## 5.6 UX & accessibility
Consistent state views, toasts for actions, optimistic where safe, IST time formatting, WCAG-minded
(semantic HTML, labels, contrast, keyboard). Responsive layouts.

## 5.7 Testing
RTL: BookingForm validation (cutoff, carpool bounds), BookingStatus/Breakdown rendering, AllocationRun table
render, guard redirects. Time-boxed for the demo; expanded in [MVP].

---

# Phase 6 — Local Setup & Deployment

## 6.1 Docker Compose
Single `docker compose up` brings up:
| Service | Image/build | Notes |
|---------|-------------|-------|
| `postgres` | postgres:16 | volume-persisted; healthcheck |
| `redis` | redis:7 | for BullMQ |
| `backend` | build `./backend` | waits for postgres healthy; runs migrate + seed on first boot; `:4000` |
| `frontend` | build `./frontend` | Vite dev/preview; `:5173`; proxies `/api` to backend |

## 6.2 Environment
Root `.env.example` documents every variable (§4.3) for backend, plus `VITE_API_BASE_URL` for the frontend.
Secrets are placeholders for local; real secrets via env/secret manager in deployment.

## 6.3 Database migrate + seed
```bash
cd backend                                  # the schema + migrations live here
npx prisma migrate dev --name init          # create schema
psql "$DATABASE_URL" -f prisma/partial-unique.sql   # F7 addendum (optional in dev)
npx prisma db seed                            # roles, Redbricks+SA, Assent+CA, users, slots, quota, config, templates
```

## 6.4 Commands (README)
```bash
# backend
npm run dev            # ts-node-dev
npm test               # jest (unit + integration)
npm run build && npm start
# frontend
npm run dev            # vite
npm test               # vitest + RTL
npm run build
```

## 6.5 README & demo script
README covers: architecture overview, prerequisites, `docker compose up`, seeded credentials
(Redbricks Super Admin / Assent Company Admin / sample users), and a **step-by-step demo script** matching the
hero flow (login → book → run allocation → breakdown → release). This is the artifact the presenter follows on
30 Jul.

## 6.6 Deployment recommendations — [Later]
Containerized deploy to dev/test/staging/prod; managed Postgres + Redis; run migrations in CI; secrets via a
secret manager; health checks (`/health`) + structured logs; horizontal scaling of the API with the scheduler
running as a single worker (or leader-elected) to avoid duplicate job execution.

---

## Sign-off checklist
Confirm these before implementation starts:
- [ ] API conventions + error envelope (§3.1–3.2) and the endpoint set (§3.4).
- [ ] Allocation algorithm + tie-breakers + release rule (§4.5).
- [ ] Scheduler jobs are config-driven, with a manual trigger for the demo (§4.6).
- [ ] Frontend screen set + hero-flow scope (§5.4) on React + Tailwind.
- [ ] Setup = one `docker compose up` with seed + demo script (§6).
- [ ] Demo scope = hero flow; common pool / email / reports are fast-follows.

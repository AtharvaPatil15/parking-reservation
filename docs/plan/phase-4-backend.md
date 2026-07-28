# Phase 4 — Backend

**Goal:** implement the Express + Prisma backend for the hero flow (and MVP beyond). Full spec:
[`../phases-3-6-plan.md`](../phases-3-6-plan.md#phase-4--backend). Algorithm detail: that doc §4.5.

**Owners:** Devashish (foundation + platform/admin) · Prithviraj (booking + allocation + jobs + notifications + integration tests).
**Entry criteria:** DB schema frozen (done); `openapi.yaml` frozen (P3-10).

---

## Track A — Foundation & Platform/Admin (Devashish)

#### P4-01 · Backend scaffold · Owner: Devashish · Tag: DEMO · Deps: —
`backend/` with `package.json`, `tsconfig.json`, Express `app.ts`/`server.ts`, folder layout per spec §4.2.
- **AC:** `npm run dev` boots on `:4000`; `GET /health` returns 200; folder structure matches §4.2.
- **Evidence:** `backend/src/app.ts`, `backend/src/server.ts`, `backend/package.json`.
- **Status:** ☑ (`GET /health` → 200 verified; tsc clean)

#### P4-02 · Config module + SystemConfiguration accessor · Owner: Devashish · Tag: DEMO · Deps: P4-01,P4-03
Env loader + a **cached** `SystemConfiguration` accessor (invalidates on `PATCH /config`); `GET/PATCH /config`
with time-order + range validation (D8).
- **AC:** timings/weights read from DB not code; `PATCH /config` rejects out-of-order times
  (`primaryCutoff < primaryResultsBy ≤ commonPoolClose < commonPoolResultsBy`); change is audited.
- **Evidence:** `backend/src/config/*`, `backend/src/modules/config/*`.
- **Status:** ◐ (GET/PATCH /config live-tested: valid persists + cache invalidates; time-order, range & unknown-key all → 400. ⚠ **audit deferred to P4-10** — `updatedById` is set but no `AuditLog` write yet, and it's null until auth (P4-05). ⚠ `requireRole` guard pending P4-06)

#### P4-03 · Prisma lib + migrate + seed wiring · Owner: Devashish · Tag: DEMO · Deps: P4-01
Prisma client singleton; `prisma migrate` runs the schema; `db seed` runs `prisma/seed.ts`; F7 partial-unique SQL applied.
- **AC:** fresh DB → `migrate` + `seed` succeed; seeded Super Admin/Company Admin/users/slots/quota/config present.
- **Evidence:** `backend/src/lib/prisma.ts`; `prisma/seed.ts`; `prisma/partial-unique.sql`.
- **Status:** ☑ (migrate init + partial-unique + seed verified on fresh parking_poc: 23 tables, 5 users/2 cos/12 slots/13 config)

#### P4-04 · Cross-cutting middleware · Owner: Devashish · Tag: DEMO · Deps: P4-01
Response helpers, central error handler → envelope (§3.2), correlation-id, zod `validate()`, logger with **PII masking**.
- **AC:** all responses use the envelope; errors map to the code/status table; logs mask email/contact/address; every response has `X-Correlation-Id`.
- **Evidence:** `backend/src/middleware/*`, `backend/src/lib/{response,errors,logger}.ts`.
- **Status:** ☑ (envelope + error codes + X-Correlation-Id + zod validate + PII-masked logger; 404 envelope verified)

#### P4-05 · Auth: login + JWT · Owner: Devashish · Tag: DEMO · Deps: P4-03,P4-04
Seeded-user login → short-lived access JWT (refresh-cookie rotation is MVP). Argon2id verify.
- **AC:** `POST /auth/login` returns `{accessToken,user{role,companyId}}`; bad creds `401`; non-ACTIVE `403`.
- **Evidence:** `backend/src/modules/auth/*`.
- **Status:** ☐

#### P4-06 · RBAC + tenant-scope middleware · Owner: Devashish · Tag: DEMO · Deps: P4-05
`requireRole(...)` + `scopeToTenant()` injecting a `companyId` filter.
- **AC:** wrong role → `403`; a CA/USER cannot read another company's data (`403`/`404`); SA unrestricted.
- **Evidence:** `backend/src/middleware/{rbac,tenantScope}.ts`.
- **Status:** ☐

#### P4-07 · Companies + Company-Users modules · Owner: Devashish · Tag: MVP · Deps: P4-06
Company CRUD/status; company-user list, approval (`APPROVE|REJECT`), status, admin assignment.
- **AC:** endpoints match `openapi.yaml`; approval flips `PENDING→ACTIVE|REJECTED`; tenant-scoped.
- **Evidence:** `backend/src/modules/{companies,users}/*`.
- **Status:** ☐

#### P4-08 · Slots + Quota + Blocking modules · Owner: Devashish · Tag: DEMO(quota)/MVP · Deps: P4-06
Slot CRUD; effective-dated `CompanySlotAllocation`; `SlotBlock` (**SA any / CA own / USER forbidden**).
- **AC:** quota reads resolve the effective row for a date; blocked count subtracts from availability; blocking authz enforced.
- **Evidence:** `backend/src/modules/slots/*`.
- **Status:** ☐

#### P4-09 · Dashboards module · Owner: Devashish · Tag: DEMO · Deps: P4-06,P4-08
Aggregate counts per role.
- **AC:** the three dashboard endpoints return the counts listed in Phase-1 §1.8; tenant-scoped for CA/USER.
- **Evidence:** `backend/src/modules/dashboards/*`.
- **Status:** ☐

#### P4-10 · Audit interceptor · Owner: Devashish · Tag: MVP · Deps: P4-04
Write `AuditLog` on key mutations (approvals, blocks, quota, config, allocation, override, release).
- **AC:** each listed action writes actor/action/entity/old/new/ip/correlationId.
- **Evidence:** `backend/src/modules/audit/*`.
- **Status:** ☐

---

## Track B — Booking, Allocation, Jobs, Notifications (Prithviraj)

#### P4-11 · Allocation scoring — pure function + unit tests · Owner: Prithviraj · Tag: DEMO · Deps: —
Pure `score({distanceKm, people, weights, caps})` per decisions §3. **Written first, no DB.**
- **AC:** `distanceScore=(min(d,40)/40)*100`; `carpoolScore=((min(p,4)-1)/3)*100`; `final=0.6*d+0.4*c`; unit
  tests cover distance bands (0/10/20/30/40+), people 1–4, weighting, and all 5 tie-breakers.
- **Evidence:** `backend/src/modules/allocation/score.ts`; `backend/tests/allocation.score.test.ts` (passing).
- **Status:** ☐

#### P4-12 · Booking module · Owner: Prithviraj · Tag: DEMO · Deps: P4-06 · (stub P4-08 reads)
Create/status now; edit/cancel/release MVP. Snapshots `travelDistanceKm`; records carpool members; dedupe.
- **AC:** `POST /bookings` rejects non-weekday & post-cutoff (`422 WINDOW_CLOSED`), `carpoolPeople` 1–maxPeople,
  duplicate same-type/date (`409`); `GET /bookings/:id` returns status + slot + breakdown; only same-company
  employee members flagged scored (F4).
- **Evidence:** `backend/src/modules/bookings/*`.
- **Status:** ☐

#### P4-13 · Allocation service (transactional) + run endpoint · Owner: Prithviraj · Tag: DEMO · Deps: P4-11,P4-12
Implements the 10-step run (spec §4.5): idempotent `AllocationRun`, per-company quota-aware assignment,
tie-breakers, `SELECT … FOR UPDATE`, persist `ParkingAllocation` + `AllocationScoreBreakdown`, waitlist.
- **AC:** `POST /allocation/primary/run` is idempotent per `(runType,bookingDate)`; never double-assigns a slot
  (unique `(slotId,bookingDate)` backstop); `GET …/breakdown` returns ranked results with per-factor scores.
- **Evidence:** `backend/src/modules/allocation/service.ts`; `backend/src/modules/allocation/run.ts`.
- **Status:** ☐

#### P4-14 · Release → own-company waitlist reallocation · Owner: Prithviraj · Tag: MVP · Deps: P4-13
On release post-primary, promote the highest-score **same-company** waitlisted user; else (common pool — Later).
- **AC:** released slot reassigns to the top own-company waitlisted booking in a txn; audited + notified.
- **Evidence:** `backend/src/modules/bookings/release.ts` / allocation service.
- **Status:** ☐

#### P4-15 · Scheduler (BullMQ, config-driven) · Owner: Prithviraj · Tag: MVP(manual DEMO) · Deps: P4-02,P4-13
Jobs read times from `SystemConfiguration`; reschedule on change; retryable + idempotent. Manual trigger endpoint for the demo.
- **AC:** jobs listed in spec §4.6 exist; no hardcoded times; changing config reschedules; duplicate execution prevented.
- **Evidence:** `backend/src/jobs/*`.
- **Status:** ◐ (manual trigger = P4-13; full scheduler MVP)

#### P4-16 · Notifications (in-app) · Owner: Prithviraj · Tag: MVP · Deps: P4-13
`dispatch(eventCode, recipient, vars)` per notification plan: resolve template, render, dedupeKey, write
`Notification` rows. Email = Later.
- **AC:** allocation/release write in-app `Notification` rows; dedupeKey prevents duplicates on re-run.
- **Evidence:** `backend/src/modules/notifications/*`.
- **Status:** ☐

#### P4-17 · Common-pool derivation + allocation · Owner: Prithviraj · Tag: Later · Deps: P4-13
- **AC:** at `primaryResultsBy`, unused quota → `CommonPoolSlot`; cross-company allocation run.
- **Evidence:** `backend/src/modules/allocation/commonPool.ts`.
- **Status:** ⊘

#### P4-18 · Reports + CSV · Owner: Prithviraj · Tag: Later · Deps: P4-13
- **AC:** report queries + async CSV export.
- **Evidence:** `backend/src/modules/reports/*`.
- **Status:** ⊘

#### P4-19 · Backend integration tests · Owner: Prithviraj (+Devashish for authz) · Tag: DEMO · Deps: P4-13
Supertest + throwaway Postgres.
- **AC:** hero path (login→book→run→breakdown) passes; concurrency test proves no double-assignment; tenant-
  isolation negative test (Company A can't read Company B) passes.
- **Evidence:** `backend/tests/*.integration.test.ts`.
- **Status:** ☐

## Phase Definition of Done
DEMO tasks ☑: login, config, booking create/status, allocation run + breakdown, dashboards, and the hero
integration test all pass on a seeded DB. Scoring unit tests green. MVP/Later tasks may remain ☐/⊘.

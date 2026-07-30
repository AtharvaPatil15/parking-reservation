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
- **Status:** ☑ (GET/PATCH /config live-tested; time-order, range & unknown-key all → 400. Guarded by `requireRole('SUPER_ADMIN')` — no-auth→401, CA→403 (**finding #1 closed**). Audit now wired (P4-10): each change writes a `CONFIG_UPDATED` AuditLog row with old/new maps.)

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
- **Status:** ☑ (login verified: SA & CA get JWT + role/companyId; bad creds → 401. Also added refresh-rotation + logout via `RefreshToken`.)

#### P4-06 · RBAC + tenant-scope middleware · Owner: Devashish · Tag: DEMO · Deps: P4-05
`requireRole(...)` + `scopeToTenant()` injecting a `companyId` filter.
- **AC:** wrong role → `403`; a CA/USER cannot read another company's data (`403`/`404`); SA unrestricted.
- **Evidence:** `backend/src/middleware/{rbac,tenantScope}.ts` (+ `authenticate.ts`).
- **Status:** ☑ (verified: wrong role → 403, no token → 401; CA cross-company block/list → 403, own → ok; SA unrestricted. Resource-level scope enforced in services.)

#### P4-07 · Companies + Company-Users modules · Owner: Devashish · Tag: MVP · Deps: P4-06
Company CRUD/status; company-user list, approval (`APPROVE|REJECT`), status, admin assignment.
- **AC:** endpoints match `openapi.yaml`; approval flips `PENDING→ACTIVE|REJECTED`; tenant-scoped.
- **Evidence:** `backend/src/modules/{companies,users}/*`.
- **Status:** ☑ (CRUD/status + public `/active` + `/:id/users` + approval/status + admin-assign; SA-only & CA-own-tenant verified. Registration `POST /auth/register` is now tracked as **P4-20** (Prithviraj, in progress); seeded users still cover the hero demo.)

#### P4-08 · Slots + Quota + Blocking modules · Owner: Devashish · Tag: DEMO(quota)/MVP · Deps: P4-06
Slot CRUD; effective-dated `CompanySlotAllocation`; `SlotBlock` (**SA any / CA own / USER forbidden**).
- **AC:** quota reads resolve the effective row for a date; blocked count subtracts from availability; blocking authz enforced.
- **Evidence:** `backend/src/modules/slots/*`.
- **Status:** ☑ (slot CRUD + effective-dated quota + blocking with SA-any/CA-own authz verified; `getAvailableQuota` helper = effective quota − overlapping blocks, ready for P4-13.)

#### P4-09 · Dashboards module · Owner: Devashish · Tag: DEMO · Deps: P4-06,P4-08
Aggregate counts per role.
- **AC:** the three dashboard endpoints return the counts listed in Phase-1 §1.8; tenant-scoped for CA/USER.
- **Evidence:** `backend/src/modules/dashboards/*`.
- **Status:** ☑ (SA/CA/User endpoints verified: SA slots/companies/blocked/util, CA quota/available/booked/waitlisted, User prev-count + cutoff countdown; tenant-scoped via req.user; role-guarded 403.)

#### P4-10 · Audit interceptor · Owner: Devashish · Tag: MVP · Deps: P4-04
Write `AuditLog` on key mutations (approvals, blocks, quota, config, allocation, override, release).
- **AC:** each listed action writes actor/action/entity/old/new/ip/correlationId.
- **Evidence:** `backend/src/lib/{audit,requestContext}.ts`, `backend/src/middleware/requestContext.ts`, wired into config/users/companies/slots services.
- **Status:** ☑ (AsyncLocalStorage carries actor/ip/correlationId; recordAudit wired for CONFIG_UPDATED, USER_APPROVAL/STATUS, COMPANY_CREATED/UPDATED/STATUS/ADMIN_ASSIGNED, QUOTA_SET, SLOT_BLOCKED/UNBLOCKED. Verified rows carry actor+correlationId+old/new. allocation/override/release audits land with P4-13/14.)

---

## Track B — Booking, Allocation, Jobs, Notifications (Prithviraj)

#### P4-11 · Allocation scoring — pure function + unit tests · Owner: Prithviraj · Tag: DEMO · Deps: —
Pure `score({distanceKm, people, weights, caps})` per decisions §3. **Written first, no DB.**
- **AC:** `distanceScore=(min(d,40)/40)*100`; `carpoolScore=((min(p,4)-1)/3)*100`; `final=0.6*d+0.4*c`; unit
  tests cover distance bands (0/10/20/30/40+), people 1–4, weighting, and all 5 tie-breakers.
- **Evidence:** `backend/src/modules/allocation/score.ts`; `backend/tests/allocation.score.test.ts` (37 tests passing).
- **Status:** ☑ (merged to master, PR #9. Pure `score()` + `distanceScore`/`carpoolScore` + `rankCandidates` covering all 5 tie-breakers; the step-5 random draw is surfaced/replayable for AllocationScoreBreakdown. Vitest wired.)

#### P4-12 · Booking module · Owner: Prithviraj · Tag: DEMO · Deps: P4-06 · (stub P4-08 reads)
Create/status now; edit/cancel/release MVP. Snapshots `travelDistanceKm`; records carpool members; dedupe.
- **AC:** `POST /bookings` rejects non-weekday & post-cutoff (`422 WINDOW_CLOSED`), `carpoolPeople` 1–maxPeople,
  duplicate same-type/date (`409`); `GET /bookings/:id` returns status + slot + breakdown; only same-company
  employee members flagged scored (F4).
- **Evidence:** `backend/src/modules/bookings/*` (incl. pure `bookings.time.ts` + `tests/bookings.time.test.ts`).
- **Status:** ☑ (merged to master, PR #11. `POST /bookings` + `GET /bookings/:id`; weekday/cutoff (F1/F2)→422, cap→400, dup→409; distance snapshot (F6); same-company scoring flag (F4). Live login→book→status verified on seeded DB.)

#### P4-13 · Allocation service (transactional) + run endpoint · Owner: Prithviraj · Tag: DEMO · Deps: P4-11,P4-12
Implements the 10-step run (spec §4.5): idempotent `AllocationRun`, per-company quota-aware assignment,
tie-breakers, `SELECT … FOR UPDATE`, persist `ParkingAllocation` + `AllocationScoreBreakdown`, waitlist.
- **AC:** `POST /allocation/primary/run` is idempotent per `(runType,bookingDate)`; never double-assigns a slot
  (unique `(slotId,bookingDate)` backstop); `GET …/breakdown` returns ranked results with per-factor scores.
- **Evidence:** `backend/src/modules/allocation/{allocation.service,allocation.controller,allocation.routes,allocation.schema}.ts` (run state machine folded into `allocation.service.ts`).
- **Status:** ☑ (branch `prithviraj/P4-13-allocation-run`; full `tsc` typecheck clean. 10-step run, idempotent per (runType,bookingDate), per-company quota-aware assignment, tie-breakers + persisted random draw, `ParkingAllocation` + `AllocationScoreBreakdown`, waitlist. Concurrency safety via **SERIALIZABLE txn + unique `(slotId,bookingDate)` backstop** rather than explicit `SELECT … FOR UPDATE`. Live E2E on seeded DB: 21/21 checks — quota-limited run (block→available 2) gives 2 ALLOCATED / 1 WAITLISTED, per-factor scores match the formula (Sara 57.15 / Rahul 37.2 / Aditi 18.6), ranked breakdown, idempotent re-run. PR pending.)

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
- **Evidence:** `backend/tests/hero.integration.test.ts` + `backend/tests/integration/*` (Supertest + throwaway `parking_poc_test`).
- **Status:** ☑ (branch `prithviraj/P4-19-integration-tests`; 5 integration tests pass. Throwaway test DB provisioned by a Vitest globalSetup — DROP+CREATE `parking_poc_test` then additive `db push` + seed (never the dev DB); unit suite kept DB-free via a separate config. Covers: hero path (login→book→run→status→breakdown, scores verified), quota-limited waitlisting, two concurrent runs never double-assign a slot + a direct `(slotId,bookingDate)` unique-backstop assertion, and tenant isolation (cross-tenant read→404, SA→200).)

#### P4-20 · Auth: user registration (`POST /auth/register`) · Owner: Prithviraj · Tag: **DEMO** · Deps: P4-05, P4-07
Implements the registration endpoint the frontend RegisterPage (P5-15, PR #15) already calls, so sign-up works
end-to-end instead of only against mocks. Creates a `PENDING` user under an **ACTIVE** company; the Company
Admin approves later via the existing P4-07 flow. `GET /companies/active` (public id+name list for the company
dropdown) already exists from P4-07.
- **AC:** `POST /auth/register` per openapi `RegisterRequest` — required fields present; valid email / contact /
  PIN; `distanceKm` optional, range 0–200 (F5/D6); `password` ≥ `password.minLength` (D8) and `confirmPassword`
  matches; referenced company must exist **and** be ACTIVE (else `400`/`404`); duplicate email → `409 CONFLICT`;
  Argon2id hash; user created `status=PENDING`, `emailVerified=false`, USER role linked. Returns `201` with the
  `UserProfile` (no token). Public route (no auth); audited.
- **Evidence:** `backend/src/modules/auth/auth.{routes,controller,service,schema}.ts`.
- **Status:** ☑ (endpoint built; `tsc` clean; unit 47/47; **integration 4/4** on the P4-19 harness — register→PENDING→login `403`→CA approve→login `200`, plus duplicate-email `409`, unknown-company `400`, password-mismatch `400`. Evidence adds `backend/tests/register.integration.test.ts`.)
- **Notes:** **Promoted to [DEMO] scope (30 Jul) — on the critical path.** Email verification
  (`/auth/verify-email`) stays [Later]; the account is usable only after Company-Admin approval.

#### P4-21 · Self-service company-admin registration · Owner: Devashish · Tag: MVP · Deps: P4-20, P4-06, P4-07
Extends P4-20 so an applicant can register **as a company admin** of an existing ACTIVE company; the request
goes to the **Super Admin** for approval (mirrors the employee→Company-Admin flow, one tier up — F11).
- **AC:** `RegisterRequest.registrationType` (`EMPLOYEE`|`COMPANY_ADMIN`, default `EMPLOYEE`); `COMPANY_ADMIN`
  creates a `PENDING` user with the `COMPANY_ADMIN` role on an existing ACTIVE company (no new `Company` is
  created). Approval of such a request is **SUPER_ADMIN-only** (a Company Admin → `403`); on `APPROVE` the user
  flips to `ACTIVE` **and** a `CompanyAdmin` row is created in the same transaction; both actions audited.
  Also adds the **Super Admin approval queue**: `GET /users/pending-admins` (SA-only) lists PENDING
  `COMPANY_ADMIN` requests across all companies, surfaced as the `/admin/admin-requests` page.
- **Evidence:** `backend/openapi.yaml` (`RegisterRequest.registrationType`, `GET /users/pending-admins`);
  `backend/src/modules/auth/auth.{schema,service}.ts`; `backend/src/modules/users/{users.service,users.controller,users.routes}.ts`
  (`listPendingAdmins` + `setApproval`); FE `frontend/src/features/auth/RegisterPage.tsx` + `registerSchema.ts`,
  `frontend/src/features/superadmin/AdminApprovals.tsx` (+ nav/route, `usePendingAdmins`/`useApproveAdminRequest` hooks).
- **Status:** ☑ (backend `tsc` clean, unit 47/47, **integration 6/6** — register→PENDING(COMPANY_ADMIN)→CA-approve `403`→SA-approve `200`+`CompanyAdmin` row→login `COMPANY_ADMIN`, plus SA-queue list visible to SA / `403` for CA; FE `tsc` clean, **full suite 114/114** incl. RegisterPage CA-path + new AdminApprovals tests. Contract + FE `types.ts` regenerated.)

## Phase Definition of Done
DEMO tasks ☑: login, **registration (P4-20)**, config, booking create/status, allocation run + breakdown,
dashboards, and the hero integration test all pass on a seeded DB. Scoring unit tests green. MVP/Later tasks
may remain ☐/⊘.

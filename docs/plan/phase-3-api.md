# Phase 3 — API Contract (`backend/openapi.yaml`)

**Goal:** produce and **freeze** the OpenAPI 3.1 contract so all three tracks build in parallel against a
stable shape. Full spec: [`../phases-3-6-plan.md`](../phases-3-6-plan.md#phase-3--api-design).

**Owners:** Devashish (lead author) + Prithviraj (booking/allocation shapes).
**Entry criteria:** DB schema frozen (done). **Target:** M0 (28 Jul PM).

> This phase is "done" when `backend/openapi.yaml` validates, covers all endpoints below, and both the
> frontend mock server and backend validation are generated from it.

## Tasks

#### P3-01 · Conventions & envelope in `openapi.yaml` · Owner: Devashish · Tag: DEMO · Deps: —
Define base path, security scheme, response/error envelope, error-code map, pagination params as reusable
components.
- **AC:** `components.securitySchemes.bearerAuth`; reusable `SuccessEnvelope`, `ErrorEnvelope`,
  `Pagination`; error codes match [`../phases-3-6-plan.md`](../phases-3-6-plan.md) §3.2.
- **Evidence:** `backend/openapi.yaml` → `components`.
- **Status:** ☑ (redocly lint: valid)

#### P3-02 · Auth endpoints · Owner: Devashish · Tag: DEMO(login)/MVP · Deps: P3-01
- **AC:** `POST /auth/login` request/response exactly as spec §3.4 (returns `accessToken` + `user{role,companyId}`);
  `register/verify/refresh/logout/password` present and tagged MVP.
- **Evidence:** `backend/openapi.yaml` → `paths./auth/*`.
- **Status:** ☑ (login DEMO; register/verify/refresh/logout MVP; password-lifecycle Later per §3.4)

#### P3-03 · User(self) endpoints · Owner: Devashish · Tag: DEMO · Deps: P3-01
- **AC:** `GET /me`, `PATCH /me` (incl. `distanceKm`), `GET /me/bookings`, `GET/PATCH notifications` defined.
- **Evidence:** `backend/openapi.yaml`.
- **Status:** ☑

#### P3-04 · Companies + Company-Users endpoints · Owner: Devashish · Tag: MVP · Deps: P3-01
- **AC:** companies CRUD + status; `GET /companies` public active-subset for registration dropdown; company
  users list/approval/status/admin-assign.
- **Evidence:** `backend/openapi.yaml`.
- **Status:** ☐

#### P3-05 · Slots, Quota & Blocking endpoints · Owner: Devashish · Tag: DEMO(quota)/MVP · Deps: P3-01
- **AC:** slots CRUD; `POST/GET /companies/:id/quota` (effective-dated); blocking endpoints authorized
  **SA any / CA own / USER forbidden** (confirmed).
- **Evidence:** `backend/openapi.yaml`.
- **Status:** ☐

#### P3-06 · Booking endpoints · Owner: Prithviraj · Tag: DEMO · Deps: P3-01
- **AC:** `POST /bookings` body/response as spec §3.4 (`carpoolPeople` incl. driver, `carpoolMembers[]`);
  `GET /bookings/:id` returns status + slot + breakdown; edit/cancel/release present.
- **Evidence:** `backend/openapi.yaml` → `paths./bookings*`.
- **Status:** ☑ (POST/GET DEMO; PATCH/cancel/release MVP; common-pool Later. Added `WindowClosed` 422 response. redocly lint: 0 errors)

#### P3-07 · Allocation endpoints · Owner: Prithviraj · Tag: DEMO · Deps: P3-01
- **AC:** `POST /allocation/primary/run`, `GET /allocation/runs/:id`, `GET …/breakdown` (per-user
  distance/carpool/final scores + rank + outcome) as spec; override + common-pool present (tagged).
- **Evidence:** `backend/openapi.yaml` → `paths./allocation*`.
- **Status:** ☑ (primary run + run summary + breakdown DEMO; override MVP; common-pool run Later. redocly lint: 0 errors)

#### P3-08 · Config & Dashboard endpoints · Owner: Devashish · Tag: DEMO · Deps: P3-01
- **AC:** `GET/PATCH /config` (timings/weights, D8); `GET /dashboard/{super-admin|company-admin|user}`.
- **Evidence:** `backend/openapi.yaml`.
- **Status:** ☐

#### P3-09 · Reports endpoints (stub) · Owner: Devashish · Tag: Later · Deps: P3-01
- **AC:** `GET /reports/:type` + `/export` declared and marked Later.
- **Evidence:** `backend/openapi.yaml`.
- **Status:** ⊘

#### P3-10 · Freeze contract + generate client & mocks · Owner: Devashish · Tag: DEMO · Deps: P3-02..P3-08
- **AC:** `openapi.yaml` passes an OpenAPI linter; a typed FE client + MSW handlers are generated from it;
  contract tagged "frozen — changes via reviewed PR".
- **Evidence:** `backend/openapi.yaml`; `frontend/src/api/*` (generated); `frontend/src/mocks/*`.
- **Status:** ☐

## Phase Definition of Done
`backend/openapi.yaml` validates and covers every endpoint; FE client + MSW mocks generate from it; both
backend devs and Atharva are unblocked. DEMO-tagged paths are complete and stable.

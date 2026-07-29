# Phase 5 — Frontend (React + TypeScript + Tailwind)

**Goal:** the UI for the hero flow (and MVP beyond), built **mock-first** so it's never blocked by backend.
Full spec: [`../phases-3-6-plan.md`](../phases-3-6-plan.md#phase-5--frontend).

**Owner:** Atharva (design, development, testing — entire UI, nothing else).
**Entry criteria:** `openapi.yaml` frozen (P3-10) → generates the typed client + MSW mocks.

---

## Tasks

#### P5-01 · Scaffold + Tailwind + design tokens · Owner: Atharva · Tag: DEMO · Deps: —
Vite + React + TS + Tailwind; theme tokens (color/spacing/radius/shadow), light/dark; ESLint/Prettier.
- **AC:** `npm run dev` serves the app; Tailwind configured with tokens; base layout shell renders.
- **Evidence:** `frontend/tailwind.config.*`, `frontend/src/app/*`.
- **Status:** ☑ (Vite+React+TS+Tailwind v3; CSS-var design tokens w/ light/dark via `data-theme`; AppShell shell; ESLint/Prettier; build/lint/test all green)

#### P5-02 · Base component library · Owner: Atharva · Tag: DEMO · Deps: P5-01
Button, Input, Select, Card, Table, Badge, Modal, Toast + the four **state views** (loading/empty/error/success).
- **AC:** components reusable, accessible (labels, focus rings, keyboard), responsive; state views used app-wide.
- **Evidence:** `frontend/src/components/*`.
- **Status:** ☑ (Button/Input/Select/Card/Badge/Table/Modal/Toast + loading/empty/error/success state views; accessible labels/focus/keyboard; theme-aware; unit tests; AppShell refactored to consume them)

#### P5-03 · Router + role guards + auth context · Owner: Atharva · Tag: DEMO · Deps: P5-01
Public `/login`,`/register`; role-guarded shells `/admin/*`,`/company/*`,`/app/*`.
- **AC:** `<RequireRole>` redirects wrong-role users; unauthenticated → `/login`; token held in memory.
- **Evidence:** `frontend/src/app/router.tsx`, `frontend/src/lib/guards.tsx`.
- **Status:** ☑ (react-router-dom v6 declarative; in-memory AuthProvider/useAuth; RequireAuth/RequireRole guards; /login,/register public + /admin,/company,/app role-guarded shells; temp dev sign-in; guard + integration tests; build/lint/test green)

#### P5-04 · API layer (typed client + React Query) + MSW · Owner: Atharva · Tag: DEMO · Deps: P3-10,P5-01
Generated client from `openapi.yaml`; React Query hooks; MSW handlers for offline dev; auth interceptor.
- **AC:** hooks like `useLogin`, `useCreateBooking`, `useRunAllocation`, `useConfig` exist; MSW serves the hero
  endpoints; 401 handled.
- **Evidence:** `frontend/src/api/*`, `frontend/src/mocks/*`.
- **Status:** ☑ (typed openapi-fetch client + envelope unwrap/ApiError; @tanstack/react-query client + hero hooks useLogin/useLogout/useCreateBooking/useRunPrimaryAllocation+breakdown/useConfig/useUpdateConfig; coherent MSW hero handlers + dev toggle; auth token bridge + 401→logout; tests green)

#### P5-05 · Login page · Owner: Atharva · Tag: DEMO · Deps: P5-03,P5-04
- **AC:** form (email/password) with validation; on success stores token + routes by role; error state on 401.
- **Evidence:** `frontend/src/features/auth/LoginPage.tsx`.
- **Status:** ☑ (email/password form w/ client validation; useLogin → auth.login → role redirect honoring guard state.from; 401 form-error state; dev sign-in removed; RTL tests incl. validation/success/401/from-redirect)

#### P5-06 · User — BookingForm · Owner: Atharva · Tag: DEMO · Deps: P5-04
Date (bookable weekdays only), vehicle, **carpool people 1–4**, optional member emails, special requirement;
shows `distanceKm`.
- **AC:** client validation mirrors API (cutoff countdown disables submit; carpool bounds); submits to
  `POST /bookings`; success + error states.
- **Evidence:** `frontend/src/features/user/BookingForm.tsx`.
- **Status:** ☑ (RHF+zod BookingForm at /app/book — bookable-weekday date, vehicle, carpool 1–4 + member emails (useFieldArray), special requirement; shows distanceKm from /me; live cutoff countdown from /dashboard/user disables submit; POST /bookings with 409/422 mapped errors + success state; useMe/useUserDashboard hooks + MSW; RTL tests)

#### P5-07 · User — BookingStatus + score breakdown · Owner: Atharva · Tag: DEMO · Deps: P5-04
- **AC:** shows status, allocated slot, and the distance/carpool/final **score breakdown**; release button (MVP).
- **Evidence:** `frontend/src/features/user/BookingStatus.tsx`.
- **Status:** ☑ (BookingStatus at /app/booking/:id — status badge, allocated slot, distance/carpool/final score breakdown, carpool members; MVP release flow (modal → POST release → toast + invalidate); useBooking/useReleaseBooking + MSW; RTL tests incl. 404 + not-scored)

#### P5-08 · User — Dashboard + History · Owner: Atharva · Tag: DEMO(dash)/MVP(history) · Deps: P5-04
- **AC:** dashboard shows upcoming booking + status + cutoff countdown; history paged (MVP).
- **Evidence:** `frontend/src/features/user/{UserDashboard,History}.tsx`.
- **Status:** ☑ (UserDashboard at /app — upcoming booking + status badge + live cutoff countdown + CTAs/empty state; paged History at /app/history via useMyBookings/unwrapPage; shared statusTone; temporary ComponentGallery removed; RTL tests)

#### P5-09 · Super Admin — AllocationRun + Breakdown table · Owner: Atharva · Tag: DEMO · Deps: P5-04
The demo centerpiece.
- **AC:** date picker + **"Run primary allocation"** button; ranked table (rank, user, distance, people,
  distance/carpool/final scores, outcome, slot); loading/empty/error states.
- **Evidence:** `frontend/src/features/superadmin/AllocationRun.tsx`.
- **Status:** ☐

#### P5-10 · Super Admin — ConfigTimings · Owner: Atharva · Tag: DEMO · Deps: P5-04
- **AC:** edit all window times + weights with inline validation (ordering, ranges); PATCHes `/config`; success toast.
- **Evidence:** `frontend/src/features/superadmin/ConfigTimings.tsx`.
- **Status:** ☐

#### P5-11 · Super Admin — Dashboard + Companies/Slots/Quota · Owner: Atharva · Tag: DEMO(dash)/MVP · Deps: P5-04
- **AC:** dashboard counts (slots/companies/allocated/waitlisted/utilization); management screens MVP (seed-driven for demo).
- **Evidence:** `frontend/src/features/superadmin/*`.
- **Status:** ☐

#### P5-12 · Company Admin — Approvals + Blocks + Dashboard · Owner: Atharva · Tag: MVP · Deps: P5-04
- **AC:** approve/reject pending users; block a quota count with reason; company dashboard counts.
- **Evidence:** `frontend/src/features/companyadmin/*`.
- **Status:** ☐

#### P5-13 · Wire hero flow to live API · Owner: Atharva · Tag: DEMO · Deps: P5-05..P5-10, P4-05,P4-12,P4-13
Swap MSW → live backend for login → book → run allocation → breakdown → config.
- **AC:** the golden path works end-to-end against the running backend (no mocks) in the browser.
- **Evidence:** app runs against `VITE_API_BASE_URL`; MSW disabled in that mode.
- **Status:** ☐

#### P5-14 · Frontend tests (RTL/Vitest) · Owner: Atharva · Tag: DEMO · Deps: P5-06,P5-07,P5-09
- **AC:** tests for BookingForm validation, BookingStatus/breakdown render, AllocationRun table render, guard redirects — passing.
- **Evidence:** `frontend/src/**/*.test.tsx`.
- **Status:** ☐

## Phase Definition of Done
DEMO tasks ☑: login, booking form, booking status + breakdown, allocation run table, config screen, minimal
dashboards — all wired to the live API and covered by the listed RTL tests. Company-Admin screens + history
may remain ☐ (MVP).

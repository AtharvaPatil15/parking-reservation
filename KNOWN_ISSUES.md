# Known issues / bug log (frontend, Phase 5)

Running list of bugs found during development, to be fixed toward the end of Phase 5.
Some are expected to resolve once the UI is wired to the **live backend (P5-13)**, which
enforces the real booking lifecycle — hence deferred rather than fixed inline.

Status: 🔴 open · 🟡 partially addressed · ✅ fixed

---

## KI-1 · Release button offered for ineligible (past-date) bookings ✅
**Found:** while testing P5-07 BookingStatus.
**Symptom:** the "Release slot" button showed for any `ALLOCATED` booking regardless of `bookingDate`.
**Domain rule:** release triggers reallocation to a same-company waitlisted user **for that bookingDate** (decisions F3). A past date can't be reallocated, so release must be disallowed once the date has passed.
**Fixed (P5-10..14 branch):** `BookingStatus` now gates the release control on `status === 'ALLOCATED' && isTodayOrFuture(b.bookingDate)` (`lib/dates.isTodayOrFuture`). The live backend still rejects an ineligible release (409/422) as defense-in-depth. Regression test added (`hides release for a past-dated allocation`).

## KI-2 · Past-dated booking can display WAITLISTED ✅
**Found:** History (`/app/history`) showed a past-dated row (mock `bk-2`, 2026-07-28) as `WAITLISTED`.
**Domain rule:** `WAITLISTED` is a transient allocation-time state; a past date should be `ALLOCATED` / `REJECTED` / `EXPIRED` / `RELEASED`, never `WAITLISTED`.
**Fixed:** MSW fixtures made coherent — `bk-2` (past) is now `REJECTED` (waitlisted request that lapsed), `bk-3` (past) `RELEASED`, `bk-1` (future) `ALLOCATED`. History test updated to assert resolved statuses.

## KI-3 · Mock `GET /bookings/:id` ignores the id (detail ≠ history row) ✅
**Found:** clicking any History row opened BookingStatus showing the same fixed booking regardless of which row was clicked.
**Cause:** the MSW handler for `/bookings/:id` returned one static `BookingDetail` for every id.
**Fixed:** MSW now keeps an in-memory booking store keyed by id (`bookingState`), coherent with the `/me/bookings` list + dashboard upcoming booking; `GET /bookings/:id` returns the matching detail (404 for unknown ids). Release mutates the store so a subsequent GET reflects `RELEASED` (addresses branch-2 note L1 for release). State resets between tests via `resetMockData()`.

---

## Deferred review notes (carried from per-branch reviews — fix during P5-13/P5-14 cleanup)
- **MSW demo fidelity:** 🟡 partly addressed — `release`, config `PATCH`, company/slot/quota/block/approval mutations are now stateful (reflected on refetch, reset between tests via `resetMockData()`). A second `allocation run` and the dashboard counts remain static fixtures. *(branch-2 L1/L3)*
- **Date helpers location:** ✅ relocated `nextBookableWeekday`/`isBookableWeekday`/`formatCountdown` (+ new `isTodayOrFuture`) to `lib/dates.ts`; all callers updated. *(branch-2 L2)*
- **UserDashboard closed-cutoff a11y:** dashboard shows the closed state in a plain `<p>` (no announce), unlike BookingForm's `role="alert"`. *(branch-2 L4)*
- **`toApiError` fallback message:** collapsed `'Unexpected response'` → `'Request failed'` for an unreachable malformed-2xx path. *(P5-08)*
- **AllocationRun breakdown states:** loading/empty/error branch tests — added in the branch-2 fix wave. ✅

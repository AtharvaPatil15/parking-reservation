# Design Decisions & Review Resolutions

> Source of truth for later phases. Every decision here is intentional; if a later phase needs to
> diverge, update this file first. Timezone for all scheduling is **Asia/Kolkata (IST, UTC+05:30)**.

## 1. Locked decisions (confirmed with stakeholder)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | **Engagement scope** | Phase 1 (Requirements & Architecture) + Phase 2 (Database design, Prisma schema, seed) only. No backend/frontend code. | De-risk a large system by nailing requirements + data model before writing code. |
| D2 | **Slot ↔ company relationship** | **Quota / count-based.** Physical slots belong to the building (`OfficeLocation`/`ParkingArea`); each company holds an effective-dated *count* (`CompanySlotAllocation`). Concrete `ParkingSlot`s are assigned to winning users at allocation time. | Easier to rebalance quotas, cleaner common-pool derivation, avoids brittle physical-slot ownership. |
| D3 | **Allocation scoring** | Concrete formula — see §3. `FinalScore = 0.60·DistanceScore + 0.40·CarpoolScore`, each sub-score 0–100. | Fixed, explainable model; weights + caps configurable via `SystemConfiguration`. |
| D4 | **Rotational fairness** | Tie-breaker **only** (4th in order), not a scored factor. | Per stakeholder. See "known risk" R1 below. |
| D5 | **Slot-attribute matching (EV / accessible)** | **Deferred.** Schema stores `hasEvCharging` / `isAccessible` and booking stores `specialRequirement`, but the initial allocation treats all slots as interchangeable. | Keeps the first allocation algorithm simple; attributes captured now so matching can be added later without a migration. |
| D6 | **Geolocation / geotagging** | **Removed.** No latitude/longitude, no geocoding, no distance-matrix/map provider abstraction. Travel distance is a **single number the user enters manually (km from home to office)**. | Simpler build, no third-party map dependency or PII geolocation. |
| D7 | **Bookable days** | **Monday–Friday only.** Weekend dates are not bookable. Dynamic "next-working-day" resolution and holiday-calendar skipping are **deferred**. | Per stakeholder — not needed now. `WorkingDayConfiguration`/`Holiday` tables are retained for later use. |
| D8 | **Booking / allocation timings** | **Nothing hardcoded.** All window/cutoff/result times live in `SystemConfiguration` and are editable by the **Super Admin** at runtime. The values below are only seed *defaults*. Scheduled jobs read the current config on each run (and reschedule when it changes) rather than baking times into cron. | Different buildings/seasons need different windows without a redeploy. |

**Timing config keys (D8) — seed defaults, all Super-Admin editable:**

| Key | Default (IST) | Meaning |
|-----|---------------|---------|
| `booking.primaryCutoff` | `18:00` | Primary window closes (strictly before) |
| `booking.primaryResultsBy` | `20:00` | Primary results published; common-pool inventory created; common-pool window opens |
| `booking.commonPoolClose` | `22:00` | Common-pool window closes |
| `booking.commonPoolResultsBy` | `23:00` | Common-pool results published |
| `booking.reminderBefore` | `60` (min) | Lead time for the pre-cutoff reminder |

Validation (service layer): times must be strictly ordered `primaryCutoff < primaryResultsBy ≤ commonPoolClose < commonPoolResultsBy`; changes are audited.

## 2. Resolutions to review findings

These resolve ambiguities found while reviewing the spec (`abc.docx`). They are baked into the Phase 1
and Phase 2 documents, the Prisma schema, and the seed.

| ID | Finding | Resolution |
|----|---------|------------|
| F1 | "Next working day" undefined around weekends/holidays | **Simplified (D7).** Bookable days = Mon–Fri; weekends not bookable. The booking targets the next calendar weekday (Friday's evening window targets Monday). No holiday-calendar skipping for now. |
| F2 | Cutoff boundary "before 6:00 PM" | **Strictly `< 18:00:00` IST.** A submit/modify attempt at exactly `18:00:00.000` is rejected. Stored as config `booking.primaryCutoff = "18:00"`. |
| F3 | Waitlist vs. common pool on release | On release of an allocated slot **after** primary allocation, priority order is: **(1) the releasing company's own waitlisted users first**, then only if none remain does the slot enter the common pool for other companies. Within the own-company waitlist, users are ranked by their `FinalScore` (which already accounts for carpooling). |
| F4 | Carpool gaming risk | (a) `carpool.maxPeople` cap (default 4, **includes the driver** — see §3). (b) Only **same-company employee** members validated by `employeeEmail` count toward the People total; non-employee members are recorded but **not scored**. (c) The driver/owner is **always counted as person 1** (baked into the formula). (d) DB uniqueness prevents the same employee appearing in two carpool requests for the same date. |
| F5 | Distance source | **Manual entry (D6).** No geocoding or map provider. The user records a `distanceKm` value (home→office) on their profile; validation bounds it to a sane range (e.g. 0–200 km). |
| F6 | Distance snapshot vs. live | User stores current `distanceKm`. Each `BookingRequest` **snapshots** `travelDistanceKm` at submission, so later profile edits never retroactively alter historical scores. |
| F7 | Soft-delete vs. unique constraints | Unique business keys (e.g. `User.email`) are enforced as **partial unique indexes** `WHERE deleted_at IS NULL` via a raw-SQL migration so a soft-deleted record does not block re-use of the value. Prisma cannot express partial uniques in the DSL; the `@unique` in the schema is the pre-migration form. |
| F8 | Duplicate-allocation protection | DB-level: unique `(slotId, bookingDate)` and unique `bookingRequestId` on `ParkingAllocation`; unique `(userId, bookingDate, bookingType)` on `BookingRequest` (allows one PRIMARY + one COMMON_POOL request per date). Allocation service runs inside a transaction with row locking (`SELECT … FOR UPDATE`) — design note for the code phase. |
| F9 | `AllocationRun` lifecycle | Explicit state machine `PENDING → RUNNING → COMPLETED \| FAILED`, with `runType` (`PRIMARY`/`COMMON_POOL`), `bookingDate`, `idempotencyKey` (unique), unique `(runType, bookingDate)`, `attemptCount`. Enables idempotent + retryable + safe manual re-run. |
| F10 | Token storage / CSRF | Access token = short-lived JWT in `Authorization: Bearer` header. Refresh token = opaque, stored **HTTP-only + Secure + SameSite** cookie, rotated on use (`RefreshToken` tracks rotation + revocation). CSRF protection applies to the cookie-based refresh/logout endpoints only. |
| F11 | Onboarding bootstrap | Super Admin creates a `Company` and assigns its first `CompanyAdmin`. Company users self-register (status `PENDING`) and are approved by their Company Admin. Seed provides the Redbricks Super Admin + Assent + Assent Company Admin to bootstrap. **Self-service company-admin registration:** `POST /auth/register` accepts `registrationType` = `EMPLOYEE` (default → `USER` role, CA approves) or `COMPANY_ADMIN` (→ requests admin of an **existing ACTIVE** company; `COMPANY_ADMIN` role assigned but `PENDING`). A `COMPANY_ADMIN` request is approvable **only by the Super Admin** (a Company Admin gets `403`); approval flips the user to `ACTIVE` **and** creates the `CompanyAdmin` assignment in the same transaction. The chosen model is *join an existing company* — self-registration does **not** create a new `Company` (new tenants are still onboarded by the Super Admin). Privilege-escalation surface is gated by the SA approval step. |
| F12 | PII / India DPDP | With geolocation removed (D6), the only personal data stored is name/email/contact/**address**/PIN + a manually-entered distance. Documented stance: purpose limitation, retention note, masking of address/contact in logs. No consent-management flow is built in this scope but is flagged before production. |
| F13 | Large report CSV exports | Flagged for **async/streamed** generation in the later API phase; not built now. |

## 3. Allocation scoring formula (D3)

The driver/owner is **person 1**; carpool "People" count includes the driver.

**Step 1 — Distance Score (0–100)** — max considered distance = `allocation.maxDistanceKm` (default 40 km):
```
DistanceScore = (min(DistanceKm, 40) / 40) × 100
```
| DistanceKm | 0 | 10 | 20 | 30 | 40+ |
|-----------|---|----|----|----|-----|
| Score     | 0 | 25 | 50 | 75 | 100 |

**Step 2 — Carpool Score (0–100)** — People includes the driver, capped at `carpool.maxPeople` (default 4):
```
CarpoolScore = ((min(People, 4) - 1) / 3) × 100
```
| People | 1 | 2 | 3 | 4+ |
|--------|---|------|-------|-----|
| Score  | 0 | 33.33 | 66.67 | 100 |

**Step 3 — Final Score:**
```
FinalScore = 0.60 × DistanceScore + 0.40 × CarpoolScore
```

- `DistanceKm` = the user's manually-entered distance, **snapshotted** onto the booking at submission (F5/F6).
- `People` = 1 (driver/owner) + number of **scored** carpool members (validated same-company employees — F4).
- Weights (`0.60`/`0.40`), `maxDistanceKm` (`40`), and `maxPeople` (`4`) are configurable via `SystemConfiguration`.
- Rank by `FinalScore` desc; tie-breakers in order: (1) more People, (2) greater distance, (3) earlier
  submission, (4) fewer allocations in previous 30 days (fairness — D4), (5) secure random draw.
- Persist `DistanceScore`, `CarpoolScore`, weights, `FinalScore`, and `People` in `AllocationScoreBreakdown`
  so any outcome can be explained.

## 4. Known accepted risks

- **R1 (from D4):** With fixed weights and fairness only as a tie-breaker, long-distance / large-carpool
  users can win repeatedly and shorter-distance users may starve. Accepted for now. Mitigation path:
  promote the "allocations in previous 30 days" signal from tie-breaker to a scored, weighted factor
  (the `AllocationScoreBreakdown` table can absorb this without a schema change).
- **R2:** Non-employee carpool members cannot be verified. Mitigated by not scoring them (F4).
- **R3 (from D6):** Manually-entered distance can be inflated to boost score. Mitigated by the 40 km cap
  (diminishing benefit) + range validation; server-side verification against a map service could be added
  later if abuse appears.

## 5. Out of scope for this engagement (later phases)

Backend/Express code, REST API implementation, scheduled jobs, notification **delivery** (sending), frontend,
Docker Compose, and automated tests. These map to the spec's Phases 3–6 and are summarized in the "Next
phases" section of the Phase 1 document. Note: the spec's "distance service is unavailable" edge case is
**removed** (no distance service, per D6).

**Notification & email:** delivery is implemented later, but a **concrete design plan is produced now as a
priority** — see [`docs/notification-service-plan.md`](notification-service-plan.md). The `NotificationTemplate`
and `Notification` tables already exist in the schema to support it.

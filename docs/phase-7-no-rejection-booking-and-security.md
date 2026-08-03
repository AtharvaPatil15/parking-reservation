# Phase 7 — No-rejection booking window + Security persona

> Requirement change (2026-08-03). Supersedes the same-day 18:00 cutoff model for **PRIMARY**
> bookings. Everything else in [`decisions.md`](decisions.md) still holds — in particular D2 (quota
> model), D3 (scoring formula), D7 (Mon–Fri only), D8 (nothing hardcoded, Super-Admin editable).
> Timezone remains **Asia/Kolkata (IST, UTC+05:30)**.

## 1. Goal

Stop showing end users a rejection. Two mechanisms, together:

1. **A long, visible booking window** (next 2 or 4 weeks, Super-Admin configurable) so demand spreads
   across dates instead of piling onto tomorrow.
2. **Reserve-on-request capacity** — a submitted request immediately holds one of the company's slots
   for that date. The user sees the day's slots as a grid of boxes before submitting; when the last
   box turns grey, the request cannot be sent at all. Demand therefore never exceeds supply, so the
   scored allocation run has nothing to reject.

Scoring is **not** removed. It still runs — as a **weekly batch on the configured weekend day** — but
its job narrows from *who wins* to *which physical slot each confirmed request gets*, and the user is
told up front when that run will happen.

## 2. New decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D9 | **Booking horizon** | Rolling window of `booking.windowWeeks` weeks (2 or 4), Super-Admin configurable. | Requirement. Longer horizon spreads demand. |
| D10 | **Allocation cadence** | One **weekly batch run** on `booking.allocationRunDay` (SATURDAY \| SUNDAY) at `booking.allocationRunTime`, replacing the nightly primary run as the PRIMARY path. Internally it still calls the existing per-date `runPrimaryAllocation`, so `AllocationRun` stays unique per (type, date) and idempotent. | Requirement. Reuses the tested run rather than forking it. |
| D11 | **Decision lead time** | A date's allocation must be decided **at least `booking.approvalLeadDays` (default 3) days before that date**. Enforced structurally by the band rule (§3), not by a warning. | Requirement — the user must have ≥3 days to arrange another way to the office. |
| D12 | **Reserve on request** | A live request (`DRAFT`/`SUBMITTED`/`WAITLISTED`/`ALLOCATED`) occupies one box in its company's grid for that date from the moment it is submitted. Capacity is re-checked inside a `SERIALIZABLE` transaction at create time. | Without this the grid is decorative and the run would still have to reject somebody. |
| D13 | **Overflow outcome** | If capacity still ends up short at run time (quota lowered or slots blocked *after* requests were taken), losers become `WAITLISTED`, never `REJECTED`. | "No rejections". The existing run already behaves this way. |
| D14 | **Grid size** | One box per slot of the company's **effective quota** for that date (`CompanySlotAllocation`), not a hardcoded 12. Demo quota is seeded at 12 so the demo shows 12 boxes. | Adapts when the Super Admin changes quota; still literally "12 boxes" for the demo. |
| D15 | **Security tenancy** | `SECURITY` is a building-level operator: they register against the building company (Redbricks) and their gate screens are **not** tenant-scoped — they look up any car number in the building. | A guard at the gate serves every company. |
| D16 | **Unknown car at the gate** | Never block. Record the check-in, flag it `hadBooking = false`, and surface it on the **company admin dashboard** as an unbooked entry. | Requirement — security must never be stuck at the barrier; the company admin owns the follow-up. |
| D17 | **Vehicle master data** | A `Vehicle` registry table, loaded by a repeatable **CSV importer** (`npm run import:vehicles -- <file>`). Excel is exported to CSV so no new runtime dependency is added. | The real car-number list arrives as an Excel sheet and will be re-imported as it changes. |

## 3. The window rule (the core of this phase)

All of it lives in one pure, config-driven module: `backend/src/modules/bookings/bookings.window.ts`.

Let `runDay`/`runTime` = the weekly run slot, `L` = `approvalLeadDays`, `W` = `windowWeeks`.

**Requestable dates** (what the user may submit for), given "now":

```
earliest = date(nextRun(now)) + L days
latest   = istToday(now) + W * 7 days
requestable = bookable weekdays (Mon–Fri) in [earliest, latest]
              minus any date whose allocation run has already COMPLETED
```

**Band a run owns** (what a run executing at instant `R` decides):

```
band(R) = bookable weekdays in [ date(R) + L , date(nextRun(R)) + L )
```

The band is a half-open interval, so consecutive weekly runs **partition** the calendar: every
bookable weekday is decided exactly once, and always at least `L` days ahead of itself. Dates beyond
the band belong to the next run and stay open for requests.

Worked example — `runDay = SUNDAY`, `runTime = 20:00`, `L = 3`, `W = 2`, now = Mon 03 Aug 2026:

| | |
|---|---|
| next run | Sun **09 Aug** 20:00 IST |
| requestable now | Wed 12 Aug → Mon 17 Aug (weekdays only) |
| the 09 Aug run decides | Wed 12 Aug → Tue 18 Aug — i.e. `[12 Aug, 19 Aug)` |
| the 16 Aug run decides | Wed 19 Aug → Tue 25 Aug |

Earliest decision lead time in that example is exactly 3 days (12 Aug decided on 09 Aug) — D11 holds
by construction.

**Config keys added** (all Super-Admin editable per D8):

| Key | Type | Default | Validation |
|-----|------|---------|-----------|
| `booking.windowWeeks` | NUMBER | `2` | must be `2` or `4` |
| `booking.allocationRunDay` | STRING | `SUNDAY` | `SATURDAY` \| `SUNDAY` |
| `booking.allocationRunTime` | TIME | `20:00` | `HH:MM` |
| `booking.approvalLeadDays` | NUMBER | `3` | integer ≥ 1 |

The legacy `booking.primaryCutoff` / `primaryResultsBy` / `commonPoolClose` / `commonPoolResultsBy`
keys and their ordering validation stay untouched — the common-pool path still uses them.

## 4. Availability grid

`GET /availability?from=&to=` — authenticated; the company is always taken from the principal, never
from the query (no cross-tenant peeking). Per date it returns:

```jsonc
{
  "date": "2026-08-12",
  "quota": 12, "blocked": 2, "taken": 3, "available": 7,
  "requestable": true, "reason": null,
  "boxes": [ { "index": 1, "state": "MINE" }, { "index": 2, "state": "TAKEN" },
             { "index": 3, "state": "BLOCKED" }, { "index": 4, "state": "AVAILABLE" } ]
}
```

`taken` counts live requests, not just allocations (D12). Box states render green for `AVAILABLE`,
grey for `TAKEN`/`BLOCKED`, and the user's own reservation is highlighted so they can see themselves
in the grid. `available === 0` disables submit on the client **and** is re-enforced server-side.

## 5. Security persona

**Account lifecycle** — registers with `registrationType = SECURITY` → lands `PENDING` → the **Super
Admin** approves or rejects from the same privileged-registration queue that handles company-admin
requests (which now shows which role each request is for). Approval just flips the user to `ACTIVE`;
no `CompanyAdmin` row.

**Screens** — exactly two actions: **Check in** and **Check out**. Each opens a right-side drawer with
one field, the car number, which typeaheads against the `Vehicle` registry. Selecting/entering a known
number auto-fills owner name, company, contact and today's booking status; **Submit** stamps
`checkInAt` / `checkOutAt`.

**Data model**

- `Vehicle` — normalized `vehicleNumber` (unique, uppercased, separators stripped) + as-entered
  display form, owner name/email/contact, optional company and resolved `userId`, type, make/model.
- `GateEvent` — one row per visit: normalized car number snapshot, resolved vehicle/user/company,
  `bookingDate` (IST business date), `hadBooking`, `status` (`CHECKED_IN` → `CHECKED_OUT`),
  `checkInAt`/`checkOutAt`, and who recorded each. A **partial unique index** on
  `(vehicleNumber, bookingDate) WHERE status = 'CHECKED_IN'` makes a double check-in impossible
  while allowing many completed visits (same technique as `partial-unique.sql`).

**Endpoints**

| Method | Path | Roles |
|--------|------|-------|
| GET | `/vehicles?search=` | SECURITY, SUPER_ADMIN |
| GET | `/vehicles/lookup?number=` | SECURITY, SUPER_ADMIN |
| POST | `/gate/check-in` | SECURITY |
| POST | `/gate/check-out` | SECURITY |
| GET | `/gate/events?date=&status=` | SECURITY, SUPER_ADMIN |
| GET | `/gate/unbooked?date=` | COMPANY_ADMIN (own), SUPER_ADMIN (all) |

**Unbooked entries (D16)** — `hadBooking = false` events feed a company-admin dashboard panel
("entered without a booking"), with an optional `notes` field security can use to record that the
person was sent back.

## 6. Vehicle import

`npm run import:vehicles -- ./path/to/vehicles.csv` (dry-run with `--dry`). Header matching is
case/spacing-insensitive with aliases, so a sheet exported straight from Excel usually works:

| Field | Accepted headers |
|-------|------------------|
| `vehicleNumber` *(required)* | `vehicle number`, `car number`, `vehicle no`, `reg no`, `registration number` |
| `ownerName` *(required)* | `owner name`, `name`, `employee name` |
| `ownerEmail` | `email`, `work email`, `employee email` |
| `contactNumber` | `contact`, `contact number`, `mobile`, `phone` |
| `companyCode` | `company`, `company code` |
| `vehicleType` | `vehicle type`, `type` (CAR \| BIKE \| EV_CAR \| EV_BIKE \| OTHER) |
| `makeModel` | `make`, `model`, `make model`, `vehicle model` |
| `colour` | `colour`, `color` |

Rows upsert on the normalized number, so re-running the import is safe and picks up corrections.
`ownerEmail` is resolved to a `User` when it matches an active account, which is what lets the gate
screen show "who the person is". A small sample sheet lives at `backend/fixtures/vehicles.sample.csv`, and the seed
inserts a handful of vehicles for the existing demo users so the security flow works before the real
sheet lands.

## 7. What this phase does not change

- Scoring formula, weights, tie-breakers (D3) — untouched.
- Common-pool run, release-and-reallocate cascade (F3), waitlist mechanics — untouched.
- `AllocationRun` / `AllocationScoreBreakdown` / `CommonPoolSlot` schemas — untouched.
- The nightly per-date primary run endpoint stays available for manual/ad-hoc use; the weekly batch
  is additive.

# Phase 8 — Request queue + score-decided allocation

> Requirement change (2026-08-04). **Supersedes D12 (reserve-on-request) from
> [`phase-7-no-rejection-booking-and-security.md`](phase-7-no-rejection-booking-and-security.md).**
> Everything else in Phase 7 still holds — the rolling window (D9), the weekly batch (D10), the lead
> time (D11), the quota-sized grid (D14), and the whole security/gate persona (D15–D17).
> [`decisions.md`](decisions.md) D2 (quota), D3 (scoring formula), D7 (Mon–Fri), D8 (nothing
> hardcoded) are untouched. Timezone remains **Asia/Kolkata (IST, UTC+05:30)**.
>
> Implementation date: **2026-08-05**. Owners: **Prithviraj** (backend) + **Devashish** (contract +
> frontend).

---

## 1. The flaw this phase fixes

Phase 7 bought "no rejections" by capping demand at submit time. A request checked the company's
remaining capacity inside a `SERIALIZABLE` transaction and was refused with `CAPACITY_FULL (409)` if
the grid was full — [`bookings.service.ts:237-276`](../backend/src/modules/bookings/bookings.service.ts#L237-L276).

Three consequences, all bad:

1. **It is first-come-first-serve.** Whoever clicks first takes the box. A user 38 km away with a
   full car who submits on Tuesday loses to a user 5 km away driving alone who submitted on Monday.
   Rejection was not removed — it was moved earlier and made a test of reflexes.
2. **Scoring never decides anything.** Because submit-time capping guarantees `demand ≤ quota`, the
   ranking loop's `i < available` guard at
   [`allocation.service.ts:166-175`](../backend/src/modules/allocation/allocation.service.ts#L166-L175)
   is always true. Every request is `ALLOCATED`, nothing is ever `WAITLISTED`. Distance weight,
   carpool weight and all five tie-breakers are computed, persisted to
   `AllocationScoreBreakdown`, and never change an outcome.
3. **The grid lies about what it shows.** `taken` counts *live requests*, not allocations
   ([`bookings.availability.ts:104-128`](../backend/src/modules/bookings/bookings.availability.ts#L104-L128)),
   so a grey box before the run means "someone asked", not "someone got it". That is the land-grab
   made visible.

**The new model.** Requests go into a queue. Nothing is scarce at submit time. The weekly batch is
what decides, by score. Some users are `WAITLISTED` — and are told at least `approvalLeadDays` ahead
so they can arrange another way in. Fairness comes from the score, not from who refreshed fastest.

---

## 2. New decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| **D18** | **Requests never consume capacity** | A submitted request is a *queue entry* (`SUBMITTED`), not a reservation. `createBooking` performs **no** capacity check and can never return `CAPACITY_FULL`. Supersedes D12. | The whole point of the phase. Capacity is decided once, by score, at run time. |
| **D19** | **Rejection returns, honestly** | Over-subscription resolves to `WAITLISTED`, never `REJECTED`, and always at least `approvalLeadDays` before the date. The UI says "queued", never "held". | Phase 7's promise is downgraded from *nobody loses* to *nobody loses late or by surprise*. That is the honest version. |
| **D20** | **Per-user weekly cap** | New config `allocation.maxDaysPerUserPerWeek` (default `3`). Once a user has been allocated that many dates inside one run's band, their remaining dates in that band go to the waitlist regardless of score. | Without it the top-scoring user wins all five weekdays and the bottom user parks never. A cap is explainable to a user ("you got 3 of 5, the cap is 3") and needs no change to the scoring maths. Set the key to `5` to disable it. |
| **D21** | **Lead time drops to 1 day** | `booking.approvalLeadDays` default **3 → 1**. | Requirement: "today is Sunday, I request Mon–Fri". With `L = 3` the earliest requestable date on a Sunday is Wednesday, so Mon/Tue are closed before the queue is even consulted. `L = 1` makes the Sunday 20:00 run own exactly `[Mon, Sat)` = Mon–Fri. Cost: a waitlisted user gets one day's notice, not three. Config row, not code. |
| **D22** | **Two-phase grid** | The availability grid has a `phase`: `OPEN` (before the date's run) shows **only** green available + grey-dotted blocked; `DECIDED` (after) shows blue = your slot, grey-solid = allocated to someone else, grey-dotted = blocked. Demand pre-run is communicated as a **count**, not as boxes. | Requirement. Requests must be invisible pre-run or the grid re-teaches the land-grab. The count keeps users informed without making it a race. |

> **If you disagree with D20 or D21, change them before starting** — they are the only two decisions
> that alter behaviour rather than mechanism. D20 lives in one loop and one config key; D21 is a
> single seed value. Everything else in this phase follows from D18.

---

## 3. The model end to end

```
                 request window open (rolling, W weeks)
  user  ──POST /bookings/batch──▶  BookingRequest.status = SUBMITTED       ← queue entry, no capacity check
                                        │
                                        │   grid phase = OPEN
                                        │   boxes: green (free) + grey-dotted (blocked)
                                        │   text:  "12 slots · 18 requests so far"
                                        ▼
        weekly batch fires on runDay/runTime (or SA presses the button)
                                        │
                    for each date in band [runDate + L, nextRunDate + L)
                                        │
                   score every SUBMITTED request  ─────────┐
                   rank within company (5 tie-breakers)    │  unchanged code
                   top `quota − blocked − alreadyHeld`     │  (score.ts + allocation.service.ts)
                        ├── ALLOCATED  → ParkingAllocation + slot number
                        └── WAITLISTED → common-pool run may still place them
                                        │
                                        ▼
                                grid phase = DECIDED
                     boxes: blue = your slot N · grey-solid = someone else's
                            grey-dotted = blocked · green = genuinely unclaimed
                     landing page shows the week's outcome per date
```

**Nothing in the ranking engine changes.** `score.ts` and the rank-and-assign loop already do exactly
this; they have simply never been given more candidates than slots.

---

## 4. Scoring and ranking (restated — no code change)

Formula ([`decisions.md`](decisions.md) §3 / D3, implemented in
[`score.ts`](../backend/src/modules/allocation/score.ts)):

```
distanceScore = min(distanceKm, maxDistanceKm) / maxDistanceKm * 100
carpoolScore  = (min(people, maxPeople) - 1) / (maxPeople - 1) * 100
finalScore    = distanceWeight * distanceScore + carpoolWeight * carpoolScore
```

`people` = 1 (the driver) + carpool members who are **validated same-company active employees**
(F4 — an unrecognised email is recorded but scores nothing). All four inputs are Super-Admin
editable: `allocation.distanceWeight` (0.60), `allocation.carpoolWeight` (0.40),
`allocation.maxDistanceKm` (40), `carpool.maxPeople` (4).

Ranking, best first — `finalScore` desc, then:

| # | Tie-breaker | Direction |
|---|---|---|
| 1 | People in the car | more wins |
| 2 | Travel distance | greater wins |
| 3 | Submission time | earlier wins |
| 4 | Allocations in the previous 30 days | fewer wins (fairness, D4) |
| 5 | Secure random draw | persisted for replay |

Tie-breaker 3 is the **only** place submission order still matters, and only between requests whose
scores are otherwise identical. That is the correct amount of first-come-first-serve: a last resort,
not the rule.

Every considered request — allocated *and* waitlisted — gets an `AllocationScoreBreakdown` row with
full `tieBreakerData`, so any outcome is explainable and replayable.

---

## 5. Contract changes

### 5.1 `DayAvailability`

```jsonc
{
  "date": "2026-08-10",
  "phase": "OPEN",              // NEW: "OPEN" | "DECIDED"
  "quota": 12,
  "blocked": 2,
  "requestCount": 18,           // NEW: replaces `taken` pre-run — demand, not reservation
  "allocatedCount": 0,          // NEW: 0 while OPEN
  "available": 10,              // quota − blocked while OPEN; − allocatedCount while DECIDED
  "mine": true,                 // I have a live request for this date
  "myStatus": "SUBMITTED",      // NEW: null | SUBMITTED | ALLOCATED | WAITLISTED | RELEASED
  "mySlotNumber": null,         // NEW: set when myStatus = ALLOCATED
  "requestable": true,
  "reason": null,               // FULL is REMOVED from the enum
  "message": null,
  "boxes": [
    { "index": 1, "state": "AVAILABLE" },
    { "index": 11, "state": "BLOCKED" }
  ]
}
```

- **`taken` is removed.** Any client still reading it is reading the old FCFS model.
- **`reason: "FULL"` is removed.** Nothing is full before the run. `NO_QUOTA` and `ALREADY_BOOKED`
  stay.
- **`SlotBox` gains `slotNumber: number | null`** — the real `ParkingSlot.slotNumber`, populated
  only when `phase = DECIDED`. `index` stays the 1-based grid position.
- **`BookingWindowSummary` gains `scoring: { distanceWeight, carpoolWeight, maxDistanceKm, maxPeople }`**
  so the booking form can show the user their live score as they add carpool members, with no extra
  round-trip.

### 5.2 Box states by phase

| `phase` | `AVAILABLE` green | `TAKEN` grey solid | `BLOCKED` grey dotted | `MINE` blue |
|---|---|---|---|---|
| `OPEN` | every non-blocked box | **never emitted** | blocked count | **never emitted** |
| `DECIDED` | slots nobody holds | someone else's allocation | blocked count | your allocation, with `slotNumber` |

### 5.3 Common-pool allocations are not in the grid

The grid is *this company's* quota. A user placed by the common-pool run holds a slot sourced from
**another** company's unused quota, so it does not belong in their own company's boxes. Render it as
a separate blue chip beside the grid — `Common pool · slot 27` — driven by `myStatus = ALLOCATED`
with `mySlotNumber` set while the grid itself shows no `MINE` box. Do not try to squeeze it in; the
box count must stay equal to `quota` (D14).

### 5.4 Removed

`CAPACITY_FULL` leaves the `ErrorCode` enum, [`errors.ts`](../backend/src/lib/errors.ts)
(`CapacityFullError`), and both endpoint docs in `openapi.yaml`. Deleting it rather than reserving it
is deliberate: nothing can then quietly reintroduce the gate.

### 5.5 New config keys

| Key | Type | Default | Validation |
|---|---|---|---|
| `allocation.maxDaysPerUserPerWeek` | NUMBER | `3` | integer ≥ 1 |
| `booking.approvalLeadDays` | NUMBER | `3` → **`1`** | integer ≥ 1 (unchanged rule, new default) |

---

## 6. Task breakdown

Fourteen tasks. **Zero file overlap between the two owners** — that is the main design goal of the
split, because you are both working in one day.

| ID | Task | Owner | Files | Depends on |
|---|---|---|---|---|
| **P8-00** | Contract freeze | **both** | `openapi.yaml` | — |
| P8-01 | Remove the submit-time capacity gate | Prithviraj | `bookings.service.ts` | P8-00 |
| P8-02 | Require a profile distance to book | Prithviraj | `bookings.service.ts` | P8-01 |
| P8-03 | Two-phase availability grid | Prithviraj | `bookings.availability.ts`, `bookings.controller.ts` | P8-00 |
| P8-04 | Expose scoring weights in the window summary | Prithviraj | `bookings.window.ts` | P8-00 |
| P8-05 | Ranking hardening (quota + slot pool) | Prithviraj | `allocation.service.ts` | — |
| P8-06 | Per-user weekly cap (D20) | Prithviraj | `allocation.service.ts` | P8-05 |
| P8-07 | Config + seed changes | Prithviraj | `seed.ts`, `configValidation` | P8-00 |
| P8-08 | Backend tests: invert + add | Prithviraj | `backend/tests/*` | P8-01…P8-06 |
| P8-09 | OpenAPI + regenerate frontend types | Devashish | `openapi.yaml`, `api/types.ts` | P8-00 |
| P8-10 | Mock handlers: queue semantics | Devashish | `mocks/handlers.ts` | P8-09 |
| P8-11 | `SlotGrid`: phase-aware | Devashish | `SlotGrid.tsx` | P8-09 |
| P8-12 | `BookingForm`: queue, not reservation | Devashish | `BookingForm.tsx`, `bookingSchema.ts` | P8-10, P8-11 |
| P8-13 | `UserDashboard`: the results panel | Devashish | `UserDashboard.tsx` | P8-11 |
| P8-14 | Frontend tests | Devashish | `frontend/src/**/*.test.tsx` | P8-10…P8-13 |

---

### P8-00 · Contract freeze — *both, first, ~30 min, blocking*

Sit together. Agree §5 exactly as written (or amend it), then Devashish writes the schema changes
into `openapi.yaml` and pushes that commit alone. **Both of you branch off that commit.** Also settle
D20 and D21 now — after this point the contract is frozen for the day and any change costs both of
you a merge.

Deliverable: one pushed commit touching only `openapi.yaml`.

---

### P8-01 · Remove the submit-time capacity gate — *Prithviraj*

In `createBooking`'s transaction
([`bookings.service.ts:211-296`](../backend/src/modules/bookings/bookings.service.ts#L211-L296)):

**Delete** the capacity block ([:237-276](../backend/src/modules/bookings/bookings.service.ts#L237-L276)) —
the quota read, the blocks aggregate, the live-request count, and both `CapacityFullError` throws.

**Keep, in this order:**
1. Window check — bookable weekday, inside `[earliest, latest]`
2. Date-already-decided guard ([:215-221](../backend/src/modules/bookings/bookings.service.ts#L215-L221))
3. Duplicate guard — one PRIMARY request per user per date
4. `create({ status: 'SUBMITTED' })`

**Then simplify what the gate was propping up:**
- `withSerializableRetry` ([:91-104](../backend/src/modules/bookings/bookings.service.ts#L91-L104))
  existed *only* to make count-then-insert atomic. With no count, the composite unique constraint is
  the whole concurrency story → use a plain transaction. Keep the helper in the file; `releaseBooking`
  still needs it.
- Delete the `P2034 → CAPACITY_FULL` mapping ([:310-314](../backend/src/modules/bookings/bookings.service.ts#L310-L314)).
- Keep the `P2002` handling — it still distinguishes "duplicate booking" from "that carpool member is
  already in someone else's car today".

`createBookings` (batch) needs no logic change. Its per-date `FAILED` outcomes now only ever mean
window-closed, duplicate, or missing distance. Keep the ascending-date loop — scarcity no longer
depends on order, but the report reads better sorted.

**Acceptance:** submitting more requests than quota returns `201` for all of them. `CAPACITY_FULL`
appears nowhere in `backend/src`.

---

### P8-02 · Require a profile distance to book — *Prithviraj*

`score()` treats `travelDistanceKm: null` as `0 km`, which is the **worst** distance score. Harmless
under FCFS; under ranking it silently condemns anyone who never set an address to last place every
week.

In `createBooking`, after loading the user
([:172](../backend/src/modules/bookings/bookings.service.ts#L172)): if `user.distanceKm` is null,
`fail('distanceKm', 'Set your home → office distance in your profile before booking')` → `400
VALIDATION_ERROR`. Pre-flight it once in `createBookings` too, next to `assertTripDetails`, so a
batch fails as one clear error rather than the same message on twenty dates.

**Acceptance:** a user with no distance gets one actionable 400 naming the profile, not a silent
zero-score booking.

---

### P8-03 · Two-phase availability grid — *Prithviraj*

`bookings.availability.ts`. This is the largest backend task.

1. **Determine the phase per date.** The `completedRuns` query already exists
   ([:113-121](../backend/src/modules/bookings/bookings.availability.ts#L113-L121)) —
   `PRIMARY` + `COMPLETED` for that date means `DECIDED`, else `OPEN`.
2. **Add a fifth query:** allocations for the range, for this company, with
   `slot.slotNumber`, `bookingRequest.userId` and `allocationType`. Group by date.
3. **Replace `taken` with two counters:** `requestCount` (live `SUBMITTED`/`DRAFT` PRIMARY requests —
   informational only) and `allocatedCount` (rows from step 2).
4. **Split the box builder.** `buildBoxes` becomes two functions — they share almost nothing:
   - `buildOpenBoxes({ quota, blocked })` → `blocked` × `BLOCKED`, remainder `AVAILABLE`. Never
     `TAKEN`, never `MINE`.
   - `buildDecidedBoxes({ quota, blocked, allocations, viewerId })` → one box per allocation
     (`MINE` + `slotNumber` if `viewerId` matches, else `TAKEN` + `slotNumber`), then `blocked` ×
     `BLOCKED`, then `AVAILABLE` for the remainder. Keep the existing "own box first, then clamp to
     quota" ordering so the viewer never loses their own box to the clamp
     ([:196-211](../backend/src/modules/bookings/bookings.availability.ts#L196-L211)).
5. **`myStatus` / `mySlotNumber`** from the viewer's own request for the date (any status). A
   `COMMON_POOL` allocation sets `myStatus`/`mySlotNumber` but contributes **no** box (§5.3).
6. **Delete `reason: 'FULL'`** and its message. Keep `NO_QUOTA` and `ALREADY_BOOKED`. Keep the
   window reasons untouched.
7. **Fix the module docstring** — it currently states D12 as the module's purpose, which is now the
   opposite of what it does.

Watch: `LIVE_BOOKING_STATUSES` should no longer drive the grid. Leave the constant alone — other call
sites are still correct — just stop using it here.

**Acceptance:** the same date returns green+dotted only before the run, and blue/grey-solid/dotted
with real slot numbers after it. Box count always `=== quota`.

---

### P8-04 · Expose scoring weights in the window summary — *Prithviraj*

Add `scoring: { distanceWeight, carpoolWeight, maxDistanceKm, maxPeople }` to
`bookingWindowSummary` ([`bookings.window.ts:277-297`](../backend/src/modules/bookings/bookings.window.ts#L277-L297)),
read from config with the same fallbacks the allocation run uses.

`bookings.window.ts` is deliberately pure (no DB, no config I/O), so **pass the values in as an
argument** rather than importing config into it — resolve them in the controller/service and hand
them to the summary. Do not break that purity; the window arithmetic tests depend on it.

Small task, but it unblocks the nicest bit of P8-12: the user watching their score climb as they add
carpool members, computed client-side with zero round-trips.

---

### P8-05 · Ranking hardening — *Prithviraj*

Two real bugs that only surface once demand exceeds supply. Both were masked by submit-time capping.

**(a) Quota ignores allocations the company already holds.** `availableQuotaTx`
([`allocation.service.ts:36-52`](../backend/src/modules/allocation/allocation.service.ts#L36-L52))
returns `quota − blocked`, not minus existing `ParkingAllocation` rows for that company/date. Submit
capping used to guarantee that difference was zero. Post-change a re-run, or a run following a
release cascade, can allocate past quota. Subtract
`ParkingAllocation.count({ companyId, bookingDate })`.

**(b) Cross-company slot-pool starvation.** The rank loop
([:158-176](../backend/src/modules/allocation/allocation.service.ts#L158-L176)) walks companies in
`[...byCompany.keys()].sort()` order — i.e. by **UUID** — sharing one `poolIdx` cursor over the
physical slots. If `Σ effective quota > usable slots`, the last company by UUID silently gets
nothing. Fix: before assigning, compare the usable slot count against `Σ` effective quota for the
date and **fail the run with a clear error** naming the shortfall. A loud failure the Super Admin can
act on beats an arbitrary starved tenant. (Proportional degradation is the nicer answer; it is not
worth the day.)

**Acceptance:** a company can never hold more allocations than its effective quota for a date; an
under-provisioned building fails the run with an explicit message instead of starving one tenant.

---

### P8-06 · Per-user weekly cap (D20) — *Prithviraj*

`runWeeklyAllocation` ([:572-627](../backend/src/modules/allocation/allocation.service.ts#L572-L627))
loops the band's dates in ascending order, calling `runPrimaryAllocation` per date. Thread a
per-user allocated-count for the band through that loop and pass it into the per-date run; a user at
`allocation.maxDaysPerUserPerWeek` is skipped for the remaining dates and lands `WAITLISTED` with
`tieBreakerData.cappedByWeeklyLimit = true` so the outcome stays explainable.

Note the existing tie-breaker 4 (`allocationsPrev30d`) *does* already drift within a week — Monday's
win counts against you on Tuesday, because `prev30` counts allocations with
`bookingDate < thisDate`. But it is only a **tie-breaker**, so it fires only on exactly equal
scores. It cannot stop a high scorer taking all five days. That is what the cap is for.

**Do this task last.** If the day runs short, drop it: the fallback is "highest score wins every
day", which is defensible and is simply D20 with the key set to `5`. Everything else in Phase 8 is
required for the model to be correct; this one is a fairness refinement.

---

### P8-07 · Config + seed — *Prithviraj*

- `booking.approvalLeadDays`: seeded default `3` → **`1`** (D21).
- New key `allocation.maxDaysPerUserPerWeek` = `3`, NUMBER, integer ≥ 1 (D20).
- Add both to the Super Admin config screen's validation
  ([`configValidation.ts`](../frontend/src/features/superadmin/configValidation.ts)) — **coordinate
  with Devashish**, it is a frontend file. Simplest: Prithviraj states the rule, Devashish makes the
  edit inside P8-09. This is the one place the two tracks touch.
- Existing dev DBs keep their stored rows (effective-dated config is not re-seeded). Change
  `approvalLeadDays` to `1` **in the UI** on the live dev DB, or the Sunday→Mon-Fri flow will not
  reproduce. Same gotcha as the quota rows in Phase 7.

---

### P8-08 · Backend tests — *Prithviraj*

**Invert — these currently assert FCFS is correct:**

| Test | Now asserts | Must assert |
|---|---|---|
| [`phase7.integration.test.ts:76-92`](../backend/tests/phase7.integration.test.ts#L76-L92) | a live request is `taken` immediately (D12) | a live request consumes **no** box; `requestCount` rises, boxes stay green |
| [`phase7.integration.test.ts:155-170`](../backend/tests/phase7.integration.test.ts#L155-L170) | third request refused up front with `CAPACITY_FULL` | third request **accepted**; the run waitlists the lowest-ranked |
| [`phase7.integration.test.ts:182`](../backend/tests/phase7.integration.test.ts#L182) | duplicate is CONFLICT "not CAPACITY_FULL" | duplicate is CONFLICT (drop the comparison) |
| [`bookings-batch.integration.test.ts:108-122`](../backend/tests/bookings-batch.integration.test.ts#L108-L122) | full date → `FAILED` / `CAPACITY_FULL` | full date → `CREATED` |
| [`gate.test.ts:22-69`](../backend/tests/gate.test.ts#L22-L69) | `buildBoxes` with `taken`/`mine` | split across `buildOpenBoxes` / `buildDecidedBoxes` |

**Add — write the first one before touching any code and watch it fail:**

1. **The unfairness test.** Quota 2. Aditi (12.4 km) submits **first**, Rahul (24.8 km) second, Sara
   (38.1 km) **last**. Run. Assert `Sara = ALLOCATED`, `Rahul = ALLOCATED`, `Aditi = WAITLISTED`.
   This is impossible to pass today and is the single proof the phase worked.
2. Over-subscription: 5 requests / 2 slots → 2 `ALLOCATED` + 3 `WAITLISTED`, and a breakdown row for
   **all five**.
3. Each tie-breaker exercised through the real run, not just the `score.ts` units.
4. Carpool changes the winner: Aditi + 3 scored members (58.6) beats solo Sara (57.15).
5. Weekly cap (D20): one user requests Mon–Fri and wins everything on score → exactly
   `maxDaysPerUserPerWeek` allocations, rest waitlisted with `cappedByWeeklyLimit`.
6. Quota hardening (P8-05a): a company with an existing allocation cannot exceed quota on a re-run.
7. Slot shortfall (P8-05b) fails the run loudly.
8. Grid phase transition: same date, before vs after the run, different box states.
9. A waitlisted user is picked up by the common-pool run.
10. No-distance user gets a 400 naming the profile.

---

### P8-09 · OpenAPI + types — *Devashish*

Land §5 in full: `DayAvailability` (`phase`, `requestCount`, `allocatedCount`, `myStatus`,
`mySlotNumber`; remove `taken`), `SlotBox.slotNumber`, `BookingWindowSummary.scoring`, remove
`CAPACITY_FULL` from `ErrorCode` ([`openapi.yaml:2377`](../backend/openapi.yaml#L2377)) and from
both endpoint descriptions ([:575](../backend/openapi.yaml#L575),
[:3183](../backend/openapi.yaml#L3183)). Regenerate `frontend/src/api/types.ts`. Add the two config
keys to `configValidation.ts` per P8-07.

---

### P8-10 · Mock handlers — *Devashish*

[`mocks/handlers.ts`](../frontend/src/mocks/handlers.ts) reimplements the FCFS model client-side and
must follow the same rules, or mock mode will contradict live mode:

- the `FULL` / `available === 0` grid logic at [:1116-1122](../frontend/src/mocks/handlers.ts#L1116-L1122)
- the `CAPACITY_FULL` responses at [:635](../frontend/src/mocks/handlers.ts#L635) and
  [:690](../frontend/src/mocks/handlers.ts#L690)

Add a mock toggle that flips a date between `OPEN` and `DECIDED` — that is what lets you build
P8-13 without a database, and it makes the phase transition demoable in mock mode.

---

### P8-11 · `SlotGrid` — *Devashish*

[`SlotGrid.tsx`](../frontend/src/components/SlotGrid.tsx). The four colours are already right —
green / grey-solid / grey-dotted / blue-primary. Needed:

- render `slotNumber` (not the grid `index`) on `MINE` and `TAKEN` when `phase = DECIDED`
- `SlotGridLegend` takes a `phase` and shows **only Available + Blocked** when `OPEN` — a legend
  listing "Booked" pre-run tells the user requests take boxes, which is exactly the wrong lesson
- keep the non-colour signals: every box keeps its `title` and screen-reader text, now including the
  real slot number

---

### P8-12 · `BookingForm` — *Devashish*

[`BookingForm.tsx`](../frontend/src/features/user/BookingForm.tsx). Every capacity assumption comes
out:

- row subtitle: `12 slots · 18 requests so far` instead of `7 of 12 free`
  ([:386-390](../frontend/src/features/user/BookingForm.tsx#L386-L390))
- `unbookableSelected` / `submitBlocked` ([:237-238](../frontend/src/features/user/BookingForm.tsx#L237-L238))
  reduce to "inside the window, and not already requested by me". The button no longer says
  "Pick an available date" because of fullness.
- **success copy is the most important change in the whole phase**
  ([:155-163](../frontend/src/features/user/BookingForm.tsx#L155-L163)): *"Your slots are held.
  Results are published …"* becomes *"5 requests queued. Results are published Sunday 09 Aug, 20:00
  — you'll be told which dates you got at least 1 day before each date."* A user who thinks they hold
  a slot and then gets waitlisted is the failure mode this phase must not ship.
- **live score panel** using `window.scoring` from P8-04: *"Your score: 31.9 — 12.4 km (31.0) +
  2 people (33.3)"*, recomputing as carpool members are added. Same formula as §4; it is three lines
  of arithmetic client-side.
- a plain-language note that requests are ranked, not first-come-first-serve.

---

### P8-13 · `UserDashboard` results panel — *Devashish*

Biggest new UI. [`UserDashboard.tsx`](../frontend/src/features/user/UserDashboard.tsx) currently
shows only an "Upcoming booking" card with a status badge — the post-results view the requirement
asks for **does not exist**.

Add a **"Your week"** panel: one row per date in the window, each with its `SlotGrid`, showing
blue = your slot N / grey-solid = allocated to someone else / grey-dotted = blocked, plus a status
badge per row (`Queued` · `You got slot 7` · `Waitlisted` · `Blocked`). Rows before their run day
render the `OPEN` phase; decided rows render `DECIDED`. One `GET /bookings/availability` over the
window feeds the whole panel — no new endpoint needed.

For `WAITLISTED`, link through to [`BookingStatus`](../frontend/src/features/user/BookingStatus.tsx)
so the user can see their score and rank. That page already renders the breakdown; check it reads
sensibly for a *losing* outcome, since it becomes the "why didn't I get it?" screen.

---

### P8-14 · Frontend tests — *Devashish*

Invert [`BookingForm.test.tsx`](../frontend/src/features/user/BookingForm.test.tsx) — it fixtures
`reason: 'FULL'` and `CAPACITY_FULL` outcomes in five places ([:147](../frontend/src/features/user/BookingForm.test.tsx#L147),
[:167](../frontend/src/features/user/BookingForm.test.tsx#L167),
[:224](../frontend/src/features/user/BookingForm.test.tsx#L224),
[:303](../frontend/src/features/user/BookingForm.test.tsx#L303),
[:347](../frontend/src/features/user/BookingForm.test.tsx#L347)).

Add: `SlotGrid` renders no `TAKEN`/`MINE` when `phase = OPEN`; slot numbers appear when `DECIDED`;
the queued-not-held success copy; the live score panel maths; `UserDashboard` renders all four row
states.

> Run the frontend suite with `--no-file-parallelism` — it is flaky in parallel on a loaded machine
> (documented in the Phase 7 e2e doc). Re-run serially before believing a failure.

---

## 7. How the day should go

Both tracks are independent after P8-00 because Devashish builds against **mock mode** while
Prithviraj builds the real backend. Neither of you is blocked waiting for the other.

| Time | Prithviraj (backend) | Devashish (contract + frontend) |
|---|---|---|
| 09:30–10:00 | **P8-00 together** — freeze §5, settle D20/D21 | **P8-00 together** |
| 10:00–11:00 | P8-08 step 1: write the unfairness test, watch it fail | P8-09 openapi + regenerate types, push early so P's `types.ts` matches |
| 11:00–13:00 | P8-01, P8-02, P8-07 | P8-10 mock handlers + `OPEN`/`DECIDED` toggle |
| 14:00–16:00 | P8-03 two-phase grid, P8-04 weights | P8-11 `SlotGrid`, P8-12 `BookingForm` |
| 16:00–17:30 | P8-05 hardening, P8-06 cap *(droppable)* | P8-13 dashboard results panel |
| 17:30–18:30 | P8-08 remaining tests | P8-14 frontend tests |
| 18:30 | **Integrate**: `VITE_USE_MOCKS=false`, walk [`phase-8-e2e-test-flow.md`](phase-8-e2e-test-flow.md) §7 together | |

**Merge discipline:** branch both off the P8-00 commit. Prithviraj touches only `backend/src` +
`backend/tests` + `seed.ts`; Devashish touches only `openapi.yaml` + `frontend/`. The two crossings
are `openapi.yaml` (Devashish only, pushed first) and `configValidation.ts` (Devashish makes the edit
Prithviraj specifies). Anything else touching both trees means the split has drifted — stop and talk.

---

## 8. What this phase does not change

- The scoring formula, weights, caps, or the five tie-breakers (D3) — **untouched**.
- `rankCandidates` and the rank-and-assign loop — untouched. They finally just get real work.
- The rolling window arithmetic, the band rule, run idempotency per `(runType, bookingDate)` (D9–D11).
- The common-pool run, the release-and-reallocate cascade (F3), waitlist mechanics.
- `AllocationRun` / `AllocationScoreBreakdown` / `CommonPoolSlot` / `ParkingAllocation` schemas — **no
  migration in this phase**.
- The whole security/gate persona and vehicle import (D15–D17).
- The Super Admin weekly-run screen and allocation breakdown screens.

---

## 9. Risks and things to say out loud

1. **"No rejections" is gone, and users must be told.** D19 downgrades it to "never late, never a
   surprise". If P8-12's copy still says "held", the phase has shipped a worse experience than
   Phase 7, not a fairer one. Treat that copy as a deliverable, not a polish item.
2. **Users lose the ability to judge contention** before requesting. `requestCount` is the
   mitigation and is not optional.
3. **A user with no profile distance is now systematically last** — hence P8-02. If P8-02 is skipped,
   the fairness fix quietly creates a new unfairness.
4. **The weekly cap (D20) is the only droppable task.** Everything else is load-bearing.
5. **Existing dev DBs will not pick up the new `approvalLeadDays`.** Change it in the Super Admin
   config UI or Sunday→Mon-Fri will not reproduce. Same class of gotcha as the Phase 7 quota rows.
6. **`CAPACITY_FULL` removal is a breaking API change.** Only these clients exist and both are in
   this repo, so it is safe — but the `types.ts` regeneration must land before P's backend is
   integration-tested against the frontend.

# Phase 8 — end-to-end test flow

How to verify **every task in [`phase-8-request-queue-allocation.md`](phase-8-request-queue-allocation.md)
individually**, then the whole flow together. Design rationale lives in that doc; this file is the
click-path and the curl-path.

Each task section has the same four parts:

- **Verifies** — the task ID and what it claims
- **Steps** — exactly what to do
- **Expect** — what a pass looks like, in numbers where possible
- **A failure here means** — which layer broke, so you are not guessing

> **Order matters for one thing only:** run §4.1 (P8-01) *before* the fix as well as after. Watching
> the third request get refused, then accepted, is the whole point of the phase. If you only test
> after, you have not tested anything.

---

## 1 · Setup

### Live mode — required for every backend task (§4.1–§4.8)

```bash
docker start local-postgres

cd backend
npm install
cp .env.example .env              # set DATABASE_URL + secrets
npm run db:migrate                # no new migration in Phase 8 — schema is unchanged
psql "$DATABASE_URL" -f prisma/partial-unique.sql
npm run db:seed
npm run dev                       # http://localhost:4000

# second terminal
cd frontend
printf 'VITE_USE_MOCKS=false\n' > .env.local
npm run dev                       # http://localhost:5173
```

### Mock mode — enough for Devashish's UI tasks (§4.9–§4.14)

```bash
cd frontend && npm install && npm run dev     # mocks are the default
```

Sign in with any password; the email prefix picks the role: `admin@…` → super admin ·
`company@…` → company admin · `security@…` → gate · anything else → user.

### Seeded logins (live mode) — password `ChangeMe#12345`

| Role | Email | Home → office |
| --- | --- | --- |
| Super admin | `superadmin@redbricks.example` | — |
| Company admin (Assent) | `admin@assent.example` | 5.2 km |
| User | `aditi@assent.example` | **12.4 km** |
| User | `rahul@assent.example` | **24.8 km** |
| User | `sara@assent.example` | **38.1 km** |

### Tokens for curl

```bash
login() { curl -s localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"ChangeMe#12345\"}" | jq -r .data.accessToken; }

SA=$(login superadmin@redbricks.example)
CA=$(login admin@assent.example)
ADITI=$(login aditi@assent.example)
RAHUL=$(login rahul@assent.example)
SARA=$(login sara@assent.example)
```

---

## 2 · Reference — the numbers you should see

Seeded weights: `distanceWeight 0.60`, `carpoolWeight 0.40`, `maxDistanceKm 40`, `maxPeople 4`.

```
distanceScore = min(km, 40) / 40 * 100
carpoolScore  = (min(people, 4) - 1) / 3 * 100
finalScore    = 0.60 * distanceScore + 0.40 * carpoolScore
```

**Solo bookings (people = 1, so `carpoolScore = 0`):**

| User | km | distanceScore | finalScore | Rank solo |
| --- | --- | --- | --- | --- |
| Sara | 38.1 | 95.25 | **57.15** | 1st |
| Rahul | 24.8 | 62.00 | **37.20** | 2nd |
| Aditi | 12.4 | 31.00 | **18.60** | 3rd |
| Company admin | 5.2 | 13.00 | 7.80 | 4th |

**Aditi with carpool members** (each member must be an Assent active user to be *scored* — F4):

| Members | people | carpoolScore | finalScore | Beats |
| --- | --- | --- | --- | --- |
| 0 | 1 | 0 | 18.60 | — |
| 1 | 2 | 33.3333 | 31.9333 | admin |
| 2 | 3 | 66.6667 | 45.2667 | Rahul |
| 3 | 4 | 100 | **58.60** | **Sara** ← the carpool demo |

### Test dates

With `booking.approvalLeadDays = 1` (D21) and `runDay = SUNDAY`, `runTime = 20:00`, run this on
**Wed 05 Aug 2026**:

| | |
| --- | --- |
| Next run | **Sun 09 Aug 2026, 20:00 IST** |
| Requestable now | **Mon 10 Aug → Wed 19 Aug** (weekdays only) |
| The 09 Aug run decides | **Mon 10 – Fri 14 Aug** (band `[10 Aug, 17 Aug)`) |

`D` below means **2026-08-10** (Monday) — the primary test date. Use Tue 11 – Fri 14 for the
multi-date tests.

> You do **not** have to wait until Sunday. A manual weekly run anchors on the *upcoming* run instant,
> so pressing the button on Wednesday decides Mon 10 – Fri 14. That is deliberate (and pinned by a
> test) — see the note on `upcomingAllocationBand`.

---

## 3 · Pre-flight — set up the scarcity

Assent's seeded quota is **12** and there are only 3 seeded users, so nothing is ever contested. Cut
capacity to 2 without touching the quota, so the grid still shows 12 boxes with 10 of them dotted —
which is also the clearest thing to demo.

1. **`approvalLeadDays` must be 1.** As of Phase 8 this is the **seeded default**, and `npm run db:seed`
   *does* overwrite existing config rows — so a reseed is enough, and the earlier claim that you had to
   set it by hand was wrong. Confirm it took: `/admin/config` → `booking.approvalLeadDays` → `1`. If it
   is still `3`, Mon/Tue come back `TOO_SOON` and nothing below reproduces.

   > **Config is cached in-process.** `src/config/systemConfig.ts` caches every key and only drops the
   > cache on `PATCH /config`. Editing a config row **directly in the database leaves the running
   > server on the old value** — which looks exactly like a broken feature. Always change config through
   > the UI/API, or restart the server.
2. **Confirm quota is 12.** `/admin/companies` → Assent → *Set quota* → 12, effective today.
3. **Block 10 slots on `D`.** Sign in as `admin@assent.example` → **`/company/blocks`** → block
   **10** slots for 2026-08-10 → 2026-08-10.

```bash
# check the arithmetic landed
curl -s "localhost:4000/api/v1/availability?from=2026-08-10&to=2026-08-14" \
  -H "authorization: Bearer $ADITI" | jq '.data.days[0]'
```

**Expect:** `quota: 12`, `blocked: 10`, `available: 2`, `phase: "OPEN"`, `requestable: true`.

---

## 4 · Per-task verification

### 4.1 · P8-01 — requests never consume capacity

**Verifies:** submitting more requests than there is capacity is accepted, and nothing is refused at
submit time.

**Run this BEFORE the fix too.** Same three commands, opposite result — that is your before/after.

**Steps**

```bash
book() { curl -s -o /dev/null -w '%{http_code}\n' localhost:4000/api/v1/bookings \
  -H "authorization: Bearer $1" -H 'content-type: application/json' \
  -d '{"bookingDate":"2026-08-10","vehicleType":"CAR","carpoolPeople":1}'; }

book $ADITI      # 1st
book $RAHUL      # 2nd
book $SARA       # 3rd — this is the one that matters
```

**Expect**

| | Aditi | Rahul | Sara |
| --- | --- | --- | --- |
| Before the fix | `201` | `201` | **`409 CAPACITY_FULL`** ← the flaw |
| After the fix | `201` | `201` | **`201`** |

Then confirm all three are queued, none allocated:

```bash
curl -s "localhost:4000/api/v1/bookings?date=2026-08-10" -H "authorization: Bearer $CA" \
  | jq '.data[] | {user: .user.email, status}'
```
**Expect:** three rows, all `SUBMITTED`.

Also grep the source — the error must be gone entirely, not just unreached:

```bash
grep -rn "CAPACITY_FULL\|CapacityFullError" backend/src   # expect: no matches
```

**UI check:** as Sara, `/book` → pick 10 Aug → **expect the submit button enabled** even though only
2 slots exist for 12 boxes, and expect no "Pick an available date".

**A failure here means** the capacity block in `createBooking` is still live, or the frontend is still
disabling submit on `available === 0`.

---

### 4.2 · P8-02 — a profile distance is required

**Verifies:** a user with no `distanceKm` cannot book and is told to fix their profile, rather than
booking with a silent worst-possible score.

**Steps**
1. As super admin, clear one user's distance (or register a fresh user and skip the distance field).
2. As that user, `POST /api/v1/bookings` for `D`.
3. Then try the batch endpoint with five dates.

**Expect**
- Single: `400`, `code: VALIDATION_ERROR`, `details[0].field: "distanceKm"`, message naming the
  profile.
- Batch: **one** 400 for the whole request — **not** five identical per-date `FAILED` rows.
- In the UI: the message appears with a link/pointer to `/profile`, not as a raw field error under a
  date picker.

**A failure here means** the guard is missing (booking succeeds → check `allocationScore` after a
run: it will be 0.00 and the user will be bottom-ranked forever), or the batch pre-flight was not
wired next to `assertTripDetails`.

---

### 4.3 · P8-03 — two-phase grid

**Verifies:** the grid shows demand as a number and capacity as boxes before the run, and real
outcomes with real slot numbers after it.

**Steps — phase `OPEN`** (with the three requests from §4.1 in place)

```bash
curl -s "localhost:4000/api/v1/availability?from=2026-08-10&to=2026-08-10" \
  -H "authorization: Bearer $ADITI" \
  | jq '.data.days[0] | {phase, quota, blocked, requestCount, allocatedCount, mine, myStatus,
                         states: (.boxes | map(.state) | group_by(.) | map({(.[0]): length}) | add)}'
```

**Expect**

```jsonc
{
  "phase": "OPEN",
  "quota": 12, "blocked": 10,
  "requestCount": 3,          // demand is visible…
  "allocatedCount": 0,
  "mine": true, "myStatus": "SUBMITTED",
  "states": { "AVAILABLE": 2, "BLOCKED": 10 }   // …but consumes no box
}
```

Assert explicitly: **no `TAKEN`, no `MINE` box, and `reason` is never `"FULL"`.** `taken` must not
exist as a field at all.

**Steps — phase `DECIDED`.** Trigger the run (§4.6), then re-run the same command as **Sara**
(allocated) and as **Aditi** (waitlisted).

**Expect — Sara**
```jsonc
{ "phase": "DECIDED", "allocatedCount": 2, "myStatus": "ALLOCATED", "mySlotNumber": "B1-01",
  "states": { "MINE": 1, "TAKEN": 1, "BLOCKED": 10 } }
```
**Expect — Aditi**
```jsonc
{ "phase": "DECIDED", "allocatedCount": 2, "myStatus": "WAITLISTED", "mySlotNumber": null,
  "states": { "TAKEN": 2, "BLOCKED": 10 } }
```

**Invariant to check on every response:** `boxes.length === quota`, always, in both phases. And a
`MINE`/`TAKEN` box carries a real `slotNumber` (matching `/api/v1/allocations`), not the grid index.

**A failure here means:** boxes still derived from live requests (grey pre-run) → the box builder was
not split; `boxes.length !== quota` → the clamp was lost; `slotNumber` null when `DECIDED` → the
allocation join is missing.

---

### 4.4 · P8-04 — scoring weights in the window payload

**Steps**
```bash
curl -s "localhost:4000/api/v1/availability?from=2026-08-10&to=2026-08-14" \
  -H "authorization: Bearer $ADITI" | jq '.data.window.scoring'
```

**Expect:** `{ "distanceWeight": 0.6, "carpoolWeight": 0.4, "maxDistanceKm": 40, "maxPeople": 4 }`.

Then change `allocation.carpoolWeight` to `0.7` at `/admin/config`, reload, and **expect the payload
to follow** — it must be read from config, not hardcoded.

**A failure here means** the values were inlined, or config I/O was added *inside*
`bookings.window.ts` (which must stay pure — `npm test -- bookings.window` will tell you).

---

### 4.5 · P8-05 — ranking hardening

**(a) Quota is not exceeded when the company already holds allocations**

1. Run allocation for `D` (§4.6) → 2 allocations exist.
2. As Sara, release her slot: `POST /api/v1/bookings/{id}/release`. The cascade hands it to the
   own-company waitlist (Aditi).
3. Force a re-run of the same date: `POST /api/v1/allocation/primary/run` with
   `{"bookingDate":"2026-08-10"}`.

**Expect:** still **exactly 2** rows in `/api/v1/allocations?date=2026-08-10` for Assent. Never 3.

**(b) A slot shortfall fails loudly**

1. As super admin, raise total quota across companies above the number of usable `AVAILABLE` slots
   (raise Assent's quota, or soft-delete slots at `/admin/slots`).
2. Trigger the weekly run.

**Expect:** the run for that date reports **`FAILED` with a message naming the shortfall** (usable
slots vs Σ quota). **Not** a silent success in which one company got nothing.

**A failure here means** `availableQuotaTx` still returns `quota − blocked` only (a), or the
pre-assign shortfall assertion is missing (b) — in which case check whether the alphabetically-last
company by UUID got zero allocations, which is the symptom.

---

### 4.6 · The weekly run, and no per-user cap

**The run itself**

```bash
curl -s localhost:4000/api/v1/allocation/weekly -H "authorization: Bearer $SA" \
  | jq '{band: .data.band.dates, pending: [.data.dates[] | {bookingDate, pendingRequests}]}'

curl -s -X POST localhost:4000/api/v1/allocation/weekly/run -H "authorization: Bearer $SA" \
  | jq '{band: .data.band.dates, allocated: .data.totalAllocated, waitlisted: .data.totalWaitlisted}'
```

**Expect:** band = `["2026-08-10", …, "2026-08-14"]`; for `D`, `allocated: 2` and
**`waitlisted: 1`** — the first non-zero waitlist this project has ever produced.

Then the ranked breakdown — note the response shape is `data.id` and `data.results[]`:
```bash
RUN=$(curl -s "localhost:4000/api/v1/allocation/runs?type=PRIMARY&date=2026-08-10" \
      -H "authorization: Bearer $SA" | jq -r .data.id)
curl -s "localhost:4000/api/v1/allocation/runs/$RUN/breakdown" -H "authorization: Bearer $SA" \
  | jq '.data.results[] | {rank, user, finalScore, outcome, slotNumber}'
```

**Expect exactly this ordering and these scores:**

| rank | user | finalScore | outcome | slotNumber |
| --- | --- | --- | --- | --- |
| 1 | Sara Khan | 57.15 | ALLOCATED | `B1-01` |
| 2 | Rahul Mehta | 37.2 | ALLOCATED | `B1-02` |
| 3 | Aditi Rao | 18.6 | **WAITLISTED** | `null` |

> Slot numbers are **strings** (`B1-07`), not integers — `ParkingSlot.slotNumber` is a label. Which
> two slots get used depends on the pool order, so match the shape, not the exact labels.

**Aditi submitted first and lost. That single row is the phase.** A breakdown row must exist for the
waitlisted user too — all three rows, not two.

**A winner can take the whole week — check that too (D20 rejected)**

1. Reset `D`…`D+4` (fresh DB, or clear the runs and requests for the band).
2. Block down to 1 free slot on each of Mon 10 – Fri 14.
3. As **Sara** (top score), book all five dates: `POST /api/v1/bookings/batch` with
   `bookingDates: ["2026-08-10","2026-08-11","2026-08-12","2026-08-13","2026-08-14"]`.
4. As Rahul and Aditi, book the same five.
5. Trigger the weekly run.

**Expect Sara to win all five dates**, with Rahul and Aditi waitlisted on every one. There is no
per-user cap: she outranks them every day, so she wins every day. Rahul's and Aditi's rows still carry
a full score breakdown for each date, so the outcome is explainable.

> This will get questioned by users, so be ready for it: the answer is that Sara scored highest on
> distance and carpool size on all five days. The lever is `allocation.distanceWeight` /
> `allocation.carpoolWeight` at `/admin/config`, not a quota on winning. A per-user weekly cap was
> built and deliberately removed — do not re-add one without revisiting D20.

**A failure here means** something is capping or rotating winners that should not be — check that
`runPrimaryAllocation` takes no band argument and that the assign loop is plain `i < available`.

---

### 4.7 · P8-07 — config

**Steps**
1. Fresh `npm run db:seed` on a clean DB → check `booking.approvalLeadDays` is `1`. There should be
   **no** `allocation.maxDaysPerUserPerWeek` key at all (D20 rejected); if you see one, it is a stale
   row from an earlier build — delete it.
2. At `/admin/config`, try to save `approvalLeadDays = 0`, and then `7`.
3. Set `approvalLeadDays` to `3`, reload `/book`.

**Expect:** both rejected at (2) with "Must be an integer between 1 and 6". At (3) the earliest requestable date
moves from Mon 10 Aug to **Wed 12 Aug** — proof the window follows config and that D21 is a
configuration choice, not a hardcode.

**A failure here means** validation was not added to `configValidation.ts`, or the window is reading
a default instead of the stored row.

---

### 4.8 · P8-08 — backend test suite

```bash
cd backend
npm run typecheck
npm test                   # unit
npm run test:integration   # needs Postgres
```

**Expect:** green, and specifically these present and passing:

| Must exist | Asserting |
| --- | --- |
| the unfairness test | last-submitted best-score user wins; first-submitted worst-score user is waitlisted |
| over-subscription | 5 requests / 2 slots → 2 + 3, breakdown rows for **all 5** |
| carpool flips the winner | Aditi + 3 members (58.60) beats solo Sara (57.15) |
| each tie-breaker | through the real run, not only `score.ts` units |
| quota + shortfall hardening | §4.5 (a) and (b) |
| grid phase transition | same date, `OPEN` vs `DECIDED` |
| waitlisted → common pool | the leftover is picked up |
| no-distance guard | 400 naming the profile |

**Expect these to have been rewritten, not deleted:** `phase7.integration.test.ts:76-92`,
`:155-170`, `bookings-batch.integration.test.ts:108-122`, `gate.test.ts:22-69`. A deleted test is a
lost guarantee — every one of them should still assert something, just the opposite thing.

---

### 4.9 · P8-09 — contract + generated types

```bash
cd frontend && npx tsc --noEmit
grep -n "CAPACITY_FULL" src/api/types.ts        # expect: no matches
grep -n "\"taken\"\|taken:" src/api/types.ts    # expect: no DayAvailability match
grep -n "phase\|requestCount\|mySlotNumber\|scoring" src/api/types.ts   # expect: all present
```

**Expect:** clean typecheck, and the compiler as your reviewer — any component still reading `taken`
or `CAPACITY_FULL` fails to build. That is the intended safety net; do not paper over it with `any`.

---

### 4.10 · P8-10 — mock handlers agree with the server

**Steps.** Run the same checks in mock mode and live mode side by side:
1. Mock mode: `/book`, submit more requests than capacity → **expect accepted**, same as live.
2. Toggle a date to `DECIDED` in the mocks → **expect blue/grey-solid/dotted** boxes.
3. `grep -n "CAPACITY_FULL" frontend/src/mocks/handlers.ts` → no matches.

**Expect:** mock mode and live mode are indistinguishable to the UI. Any divergence and every UI
test below is testing fiction.

---

### 4.11 · P8-11 — `SlotGrid`

**Steps** (mock mode, `/book` and the dashboard)
1. Look at an `OPEN` date's grid and its legend.
2. Look at a `DECIDED` date's grid and its legend.
3. Hover boxes; inspect with a screen reader or read the `title`/`sr-only` text.
4. Zoom to 200% and check a narrow window.

**Expect**
- `OPEN`: **only two boxes types** — green available, grey **dotted** blocked. The legend lists only
  those two. No "Booked" entry, no blue entry.
- `DECIDED`: blue (yours) with the **real slot number**, grey solid (someone else's) with its number,
  grey dotted blocked, green unclaimed. Legend lists all four.
- Every box readable without colour: `Slot 7 — Your booking` in `title` and screen-reader text.
- Box count `=== quota` at every viewport.

**A failure here means** the legend is not phase-aware (the most likely miss — it teaches the wrong
model even when the boxes are right), or `index` is being rendered where `slotNumber` belongs.

---

### 4.12 · P8-12 — `BookingForm` says "queued", never "held"

**Steps**
1. `/book` as Aditi. Read the date rows.
2. Set carpool people to 2, add `admin@assent.example` as a member. Watch the score panel.
3. Add two more Assent members (people = 4).
4. Select Mon 10 – Fri 14 and submit.

**Expect**
- Row subtitle reads demand, e.g. **`12 slots · 3 requests so far`** — not `9 of 12 free`.
- The score panel updates live: **18.60 → 31.93 → 45.27 → 58.60** as members are added (§2). The
  numbers must match the table exactly; if they drift, the client formula and `score.ts` disagree.
- Submit stays enabled regardless of how contested the date is.
- Success copy: **"5 requests queued · results published Sun 09 Aug, 20:00"** and an explicit note
  that allocation is by score, with the lead-time promise. The words *held*, *reserved* and
  *confirmed* must not appear.

**This is the highest-risk item in the phase.** A user who reads "held" and is then waitlisted has
been misled — worse than Phase 7, not better. Read the copy out loud before signing it off.

---

### 4.13 · P8-13 — the results panel on the landing page

**Steps**
1. Live mode, before the run: sign in as Aditi → `/` (dashboard).
2. Trigger the weekly run as super admin.
3. Reload the dashboard as **Sara** (allocated) and as **Aditi** (waitlisted).

**Expect**
- Before: a **"Your week"** panel, one row per date, each with an `OPEN` grid (green + dotted) and a
  **`Queued`** badge. Plus the next-run time and countdown.
- After, as Sara: her row shows **blue slot N** and a badge naming the slot.
- After, as Aditi: her row shows two grey-solid boxes, **no blue**, and a **`Waitlisted`** badge that
  links to the booking status page.
- On `BookingStatus`: her score, her rank, and what beat her — legible as an explanation of a *loss*,
  not just a receipt.
- If a user was placed by the common-pool run: a separate **`Common pool · slot 27`** chip beside the
  grid, and the grid itself still `quota` boxes wide with no `MINE` box (§5.3 of the design doc).

**A failure here means** the panel is reading only `upcomingBooking` (the old single-booking card) and
not the availability window — the symptom is a dashboard that shows one date instead of the week.

---

### 4.14 · P8-14 — frontend suite

```bash
cd frontend
npx tsc --noEmit
npm run lint
npm test -- --no-file-parallelism
```

> Always `--no-file-parallelism`. The suite is flaky in parallel on a loaded machine — a shifting set
> of unrelated tests hits the 5s timeout. Re-run serially before believing a failure.

**Expect:** green, with `reason: 'FULL'` and `CAPACITY_FULL` fixtures gone from
`BookingForm.test.tsx` (5 places) and replaced by queue-behaviour assertions.

---

## 5 · The money demo — run this end to end

Ten minutes, one story: *the same three users, the same date, and the outcome flips from "who clicked
first" to "who needs it most".*

**Setup:** fresh seed, `approvalLeadDays = 1`, Assent quota 12, **10 slots blocked on Mon 10 Aug** →
2 free.

1. **Show the grid, as Aditi.** `/book` → 10 Aug. **12 boxes: 2 green, 10 dotted.** Say out loud:
   *no grey — nobody's request takes a box.*
2. **Aditi books first** — the *nearest* user, 12.4 km, alone. Success says **queued**, and shows her
   score **18.60**.
3. **Rahul books second** (24.8 km, alone) → **37.20**.
4. **Sara books last** (38.1 km, alone) → **57.15**. *Under the old system this request was refused
   outright — `CAPACITY_FULL`.*
5. **Re-show the grid.** Still 2 green + 10 dotted, and the row now reads **`12 slots · 3 requests
   so far`**. Demand is visible; the race is not.
6. **Super admin → `/admin`.** Show the band (Mon 10 – Fri 14) and the pending count. **Trigger the
   run.**
7. **`/admin/allocation` → 10 Aug.** The ranked breakdown: Sara 57.15 ✓, Rahul 37.20 ✓, **Aditi 18.60
   — waitlisted.** *She asked first and did not get it, because she needs it least.*
8. **Sara's dashboard:** *"Your week"* → **blue, slot N**.
9. **Aditi's dashboard:** grey boxes, **`Waitlisted`**, dated **1 day before** the date itself — she
   has time to arrange another way in. Click through to see her score and why she lost.
10. **The carpool turn.** Aditi rebooks a fresh date with **3 Assent colleagues** → score **58.60**.
    Re-run → **Aditi now beats Sara.** *Fill your car and you win. That is the behaviour the whole
    scoring model exists to buy, and this is the first time in the project it has ever changed an
    outcome.*

---

## 6 · Automated coverage — run before demoing

```bash
cd backend
npm run typecheck && npm test && npm run test:integration

cd ../frontend
npx tsc --noEmit && npm run lint && npm test -- --no-file-parallelism
```

Where each Phase 8 behaviour is pinned:

| Behaviour | Test |
| --- | --- |
| Score formula + all five tie-breakers | `backend/tests/allocation.score.test.ts` *(unchanged)* |
| **Best score wins even when it submitted last** | `backend/tests/phase8.integration.test.ts` |
| Over-subscription → allocated + waitlisted split | `backend/tests/phase8.integration.test.ts` |
| Carpool flips the winner (58.60 beats 57.15) | `backend/tests/phase8.integration.test.ts` |
| Two-phase grid, end to end | `backend/tests/phase8.integration.test.ts` |
| Quota hardening (P8-05a) | `backend/tests/phase8.integration.test.ts` |
| Profile-distance guard (P8-02) | `backend/tests/phase8.integration.test.ts` |
| Queue consumes no box; no `CAPACITY_FULL` | `backend/tests/phase7.integration.test.ts` *(inverted)* |
| Queue accepts past capacity (batch) | `backend/tests/bookings-batch.integration.test.ts` *(inverted)* |
| Two-phase box building, in isolation | `backend/tests/gate.test.ts` *(split in two)* |
| Window arithmetic, band partitioning, lead time | `backend/tests/bookings.window.test.ts` *(fixture pinned to lead 3)* |
| The shipped 1-day lead + Sunday→Mon-Fri band (D21) | `backend/tests/bookings.window.test.ts` |
| Release cascade still ranks by score | `backend/tests/release-booking.integration.test.ts` *(unchanged)* |
| Grid states + phase + accessibility | `frontend/src/components/SlotGrid.test.tsx` — *Devashish* |
| Queued-not-held copy, live score panel | `frontend/src/features/user/BookingForm.test.tsx` — *Devashish* |
| Results panel, four row states | `frontend/src/features/user/UserDashboard.test.tsx` — *Devashish* |

> **Not covered, deliberately:** the slot-pool shortfall guard (P8-05b). Forcing it needs a
> building-wide quota/slot imbalance that would fight every other test's fixtures, so it is verified by
> hand per §4.5(b).

---

## 7 · Regression checklist — Phase 7 must still work

Phase 8 touches the booking front door and the grid. Walk these to prove it did not break anything
around them. Full detail in [`phase-7-e2e-test-flow.md`](phase-7-e2e-test-flow.md).

| # | Check | Expect |
| --- | --- | --- |
| 1 | Window still bounds requests | a date before `earliest` → `422 WINDOW_CLOSED`; past `latest` → `422 BEYOND_WINDOW` |
| 2 | A decided date is closed | booking a date whose run COMPLETED → `422`, whatever the window says |
| 3 | Duplicate guard | same user, same date, twice → `409 CONFLICT` |
| 4 | Carpool member can't be in two cars | same member email on two bookings for one date → `409` |
| 5 | Edit before the run | `PATCH /bookings/{id}` works while `SUBMITTED`; `422` once decided |
| 6 | Release → reallocate (F3) | released slot goes to the own-company waitlist first, then cross-company by score |
| 7 | Common-pool run | primary waitlist is auto-enrolled and ranked cross-company |
| 8 | Scheduler fires on the configured day only | `allocation.scheduler.test.ts` green |
| 9 | Run idempotency | re-running a COMPLETED date changes nothing; the button relabels and disables |
| 10 | Weekends never bookable | Sat/Sun → `NOT_WEEKDAY`, absent from the picker |
| 11 | Tenant isolation | Assent's requests invisible in another company's grid |
| 12 | Gate persona untouched | check-in / check-out / unknown-car-warn-but-allow all still work |
| 13 | Company admin roster | `/company` booking roster shows the new `WAITLISTED` rows sensibly |
| 14 | Vehicle import | `npm run import:vehicles -- ./fixtures/vehicles.sample.csv --dry` still parses |

---

## 8 · Known gaps after Phase 8

- **No notification when you are waitlisted.** The user finds out by opening the dashboard. Real
  email/push is still the unbuilt notification service
  ([`notification-service-plan.md`](notification-service-plan.md)). With `approvalLeadDays = 1` the
  notice period is one day, so this gap matters more than it did under Phase 7's 3 days — worth
  deciding whether in-app is enough for the demo.
- **Slot-pool shortfall fails the run rather than degrading gracefully.** Deliberate (P8-05b): loud
  beats arbitrary. Proportional allocation across companies is the nicer fix and is not in this phase.
- **One user can win every day of the week.** There is no per-user cap (D20 rejected): the score
  decides, and if the same person scores highest all week they park all week. Retune
  `allocation.distanceWeight` / `allocation.carpoolWeight` if the outcome looks wrong — do not add a
  cap without revisiting D20.
- **`requestCount` reveals aggregate demand** for your own company's dates. Intentional, and no
  per-user detail leaks — but it is new information a user did not have before.

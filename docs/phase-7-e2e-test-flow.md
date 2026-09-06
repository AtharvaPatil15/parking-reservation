# Phase 7 — end-to-end test flow

Manual walkthrough for the two things Phase 7 added: the **no-rejection booking window** and the
**security (gate) persona**. Design rationale lives in
[`phase-7-no-rejection-booking-and-security.md`](phase-7-no-rejection-booking-and-security.md); this file is
just the click-path, in the order a demo should follow.

Every step names the screen and what to look for, so a failure tells you *which* layer broke.

---

## 0 · Setup

Two ways to run. **Mock mode** needs no database and is enough to review every screen; **live mode**
exercises the real rules (capacity, transactions, approval).

### Mock mode (fastest)
```bash
cd frontend && npm install && npm run dev      # http://localhost:5173
```
Mocks are the default. Sign in with any password and a username whose prefix picks the role:
`admin…` → super admin · `company…` → company admin · `security…` → gate operator · anything else → user.

### Live mode (real backend + Postgres)
```bash
docker start local-postgres

cd backend
npm install                      # postinstall generates the Prisma client
cp .env.example .env             # set DATABASE_URL + secrets
npm run db:migrate               # or: npm run db:deploy
psql "$DATABASE_URL" -f prisma/partial-unique.sql
npm run db:seed
npm run import:vehicles -- ./fixtures/vehicles.sample.csv   # optional: more cars
npm run dev                      # http://localhost:4000

# second terminal
cd frontend
printf 'VITE_USE_MOCKS=false\n' > .env.local
npm run dev                      # http://localhost:5173
```

**Seeded logins** — password `ChangeMe#12345` for all:

| Role | Username |
| --- | --- |
| Super admin | `superadmin` |
| Company admin (Assent) | `companyadmin` |
| Users (Assent) | `aditi` · `rahul` · `sara` |
| Security (gate) | `security1` |

**Seeded cars** (the gate looks up the *normalized* plate, so `mh12 ab 1234` also matches):

| Plate | Driver | Note |
| --- | --- | --- |
| `MH12AB1234` | Aditi Rao | linked account |
| `MH12CD5678` | Rahul Mehta | linked account |
| `MH14EF9012` | Sara Khan | EV |
| `MH12GH3456` | Assent Company Admin | linked account |
| `MH12XY7788` | Vikram Joshi (contractor) | **no account** — exercises the unknown-driver path |

> **Before demoing the 12-box grid:** the grid renders the company's *effective* quota. Set Assent's
> quota to **12** at `/admin/companies` → *Set quota*. A live DB that has been edited by hand may hold a
> smaller effective row, which is correct effective-dating, not a bug — the grid simply shows fewer boxes.

---

## 1 · Security persona: register → approve → gate

This is the flow that was broken until commit `ddefc9d` (choosing "Security" failed client-side
validation), so run it first.

### 1.1 Register as a guard
1. Sign out. Go to **`/register`**.
2. In **Registering as**, choose **Security — operate the gate**.
3. **Expect the form to collapse.** *Company*, *Address*, *PIN code* and *Home → office distance*
   disappear, leaving exactly six fields: full name, registering as, username, contact number, password,
   confirm password.
4. Fill them in (e.g. `guard2`, `9000000200`) and submit.
5. **Expect:** "Registration submitted" with *"Your security request is pending approval by the super
   admin."* — not the company-admin wording, and not the employee wording.

> Why no company picker: the gate serves the whole building, so the server files a guard under the
> building company itself (D15). It resolves that server-side — a `companyId` sent by a client is ignored,
> so a guard can never be filed under a tenant.

### 1.2 Login is blocked while pending
6. Try to sign in as the new guard. **Expect a rejection** — the account is `PENDING`.

### 1.3 Super admin approves
7. Sign in as `superadmin`, go to **`/admin/admin-requests`**.
8. **Expect the guard in the queue** alongside any company-admin requests — both are super-admin
   approved. Approve it.
9. Approval here only *activates* the account. Unlike a company-admin request it grants no
   `CompanyAdmin` assignment.

> Negative check (live mode): a company admin must not be able to approve a guard. `companyadmin`
> gets a **404**, not a 403 — the guard sits under the building company, so a tenant admin cannot even see
> the record. Two independent guards deny it: tenant scoping *and* the privileged-role check.

### 1.4 The gate console
10. Sign in as the guard (new account, or the seeded `security1`).
11. **Expect to land on `/security` with exactly two actions: Check in and Check out.** No booking, no
    dashboard, no admin nav — a guard's screens are their whole job.

### 1.5 Check in a known car, with a booking
12. **Check in** → drawer opens with a single car-number field.
13. Type a partial plate (e.g. `mh12ab`). **Expect a typeahead** from the vehicle registry.
14. Pick `MH12AB1234`. **Expect the driver's details to auto-fill** (name, company, car) — the guard
    types a plate and nothing else.
15. Submit. **Expect** the visit to appear in today's log with a check-in time.
16. Press **Check in** for the same car again. **Expect a 409** — one open visit per car per day.

### 1.6 Check out
17. **Check out** → same plate → submit. **Expect** the log row to close with a check-out time.
18. Check-out finds the *latest open* visit, so a car that entered before midnight still closes correctly.

### 1.7 Unknown driver / no booking — warn but allow (D16)
19. **Check in** `MH12XY7788` (the contractor, no account) — or any known car with no booking today.
20. **Expect a warning that the driver has no booking, and expect the submit button to stay enabled.**
    The barrier is never blocked. Recording the entry is the point; refusing it is not.
21. Submit, then sign in as `companyadmin` and open the **company dashboard** (`/company`).
22. **Expect the entry in the unbooked-entries list** — that is the follow-up trail the company admin
    acts on.
23. Type a plate that is in no registry at all. **Expect it still to be accepted** and recorded against
    the raw plate.

---

## 2 · No-rejection booking window

### 2.1 The window and the next run
1. Sign in as `aditi` → **`/book`**.
2. **Expect** a rolling window of the configured length (default **2 weeks**), weekends excluded, and a
   banner naming when results are published plus a live countdown.
3. **Expect the earliest selectable date to be at least `approvalLeadDays` (3) days after the next run** —
   so anyone who misses out still has time to arrange another way in. That is the whole point of the phase.

### 2.2 The slot grid
4. **Expect one row per date, each with a miniature grid**, and a full grid for the selected date.
5. **Expect box states to be distinguishable without colour**: available (green), taken (grey), blocked
   (grey **dashed**), yours (highlighted). Hover for a tooltip; each box also carries screen-reader text.
6. The form should land on the first bookable date automatically rather than an arbitrary "tomorrow".

### 2.3 Booking until full — the no-rejection guarantee
7. Submit a request. **Expect** it to be accepted and a slot to be *held* immediately.
8. Keep booking that date as different users until the grid is full. Quickest route: sign in as
   `companyadmin` and use **`/company/blocks`** to block the date down to a single free slot, then
   take it as a user. (Blocking is a company-admin screen — the super admin has no block UI.)
9. **Expect the submit button to become "Pick an available date"** once the chosen date is full, and the
   date to be unselectable in the overview.
10. If two people race for the last slot, the loser gets **`CAPACITY_FULL` (409)** and the grid refreshes
    itself. Nobody is rejected *after the fact* — that is enforced in a `SERIALIZABLE` transaction,
    because no unique constraint can guard a *count*.

### 2.4 Super admin: the weekly run
11. Sign in as super admin → **`/admin`** (the weekly-run screen is the landing page).
12. **Expect the upcoming band of dates** the next run will decide, and the run's scheduled instant.
13. Trigger the run. **Expect every date in the band to be decided, with 0 rejected.**
14. Go to **`/admin/allocation`**, pick a decided date. **Expect the stored ranked breakdown to load
    without re-running**, and the run button to relabel itself to "Primary allocation already done" and
    disable — a run is per date and must not be repeatable.
15. The scheduler fires the same batch automatically on the configured day/time
    (`booking.allocationRunDay` / `booking.allocationRunTime`, default Sunday 20:00 IST), so the automatic
    and manual paths cannot diverge.

### 2.5 Configuration (super admin)
16. **`/admin/config`** → change `booking.windowWeeks` from 2 to 4.
17. Reload `/book`. **Expect the window to extend** and the grid rows to follow. Also configurable:
    the run day, run time and approval lead days.

---

## 3 · Automated coverage

Run these before demoing; they cover the same ground far faster than clicking.

```bash
cd backend
npm run typecheck
npm test                  # 104 unit
npm run test:integration  # 66 integration (needs Postgres)

cd ../frontend
npx tsc --noEmit
npm run lint
npm test -- --no-file-parallelism    # 165
```

> The frontend suite is **flaky when run in parallel on a loaded machine** — a shifting set of unrelated
> tests hits the 5-second timeout. `--no-file-parallelism` is green. If you see failures, re-run serially
> before believing them.

Where each behaviour is pinned:

| Behaviour | Test |
| --- | --- |
| Window arithmetic, lead time, band partitioning | `backend/tests/bookings.window.test.ts` |
| Gate lookup, check-in/out, unbooked entries | `backend/tests/gate.test.ts` |
| Window gate + capacity + grid, end to end | `backend/tests/phase7.integration.test.ts` |
| Weekly run fires on the configured day only | `backend/tests/allocation.scheduler.test.ts` |
| Security register → SA approval → login | `backend/tests/register.integration.test.ts` |
| Guard form collapses to six fields | `frontend/src/features/auth/RegisterPage.test.tsx` |
| Grid box states / accessibility | `frontend/src/components/SlotGrid.test.tsx` |
| Gate console + drawer | `frontend/src/features/security/GateConsole.test.tsx` |
| Booking form window + grid + full-date block | `frontend/src/features/user/BookingForm.test.tsx` |

---

## 4 · Known gaps

- **The real vehicle Excel sheet is still outstanding.** The importer and its sample sheet are built
  against assumed column names (`backend/scripts/vehicleCsv.ts` → `HEADERS`). Re-check those aliases
  against the real headers when the file arrives; the importer is a `--dry` run away from being safe to
  try (`npm run import:vehicles -- <file> --dry`).
- A guard carries no home address or PIN (blank, not null — widening those columns would ripple through
  every screen that renders a user). If a guard ever edits their profile, the profile form will still ask
  for them.

# End-to-end testing — from super admin only

A single pass through every persona, starting from exactly what `npm run seed:essentials` leaves you
with: **one super admin, one building, and nothing else**. No companies, no users, no slots, no cars.

Follow it in order. Each step creates what the next one needs, so skipping one produces a confusing
failure two steps later — where noted, that failure is called out so you recognise it.

> **Design docs:** [decisions.md](docs/decisions.md) ·
> [phase 7](docs/phase-7-no-rejection-booking-and-security.md) ·
> [deployment](docs/deployment.md)

---

## 0 · What you start with

```
Roles                     4  (SUPER_ADMIN, COMPANY_ADMIN, USER, SECURITY)
Operator company          1  Redbricks (Building Administrator)
Users                     1  your super admin — ACTIVE
Office location           1  Redbricks Tower, Baner
Parking area              1  Basement 1
Parking slots             0  ← you create these
System configuration     19  weights, run schedule, booking window
Working days              7  Mon–Fri working
Notification templates   13
```

Sign in with the super admin email and the `SUPERADMIN_PASSWORD` you seeded with.

If you need to start over: `npm run db:wipe` then `npm run seed:essentials`.

### How booking works, in one paragraph

Read this before testing — it explains why the screens say what they say.

**A request is a queue entry, not a reservation** (D18). Asking for a date never consumes a slot, so a
date can never be "full" at booking time and nobody is turned away when they ask. Demand just shows as a
count: *"12 slots · 5 requests so far"*. On the configured run day the allocation runs, scores every
request for that date, and only then are slots assigned — at which point the date flips from **OPEN** to
**DECIDED** and starts showing who got what. The only reasons a date can be unpickable are: outside the
window, already decided, or you already asked for it.

---

## 1 · Super admin — build the building

Sign in → you land on the super admin dashboard.

### 1.1 Parking slots — `/admin/slots`

Add slots into **Basement 1**. Enter a slot number, pick the area, **Add slot**. Do at least 4; a dozen
makes the allocation results more interesting.

> **Skip this and nothing works.** A quota only says how many slots a company may *win* — the allocation
> run needs real bays to hand out, and throws *"Not enough usable parking slots"* without them.

### 1.2 A tenant company — `/admin/companies`

**Add company** with a name and a short code (e.g. `Assent` / `ASSENT`).

### 1.3 A quota for it — `/admin/companies` → **Set quota**

Set the slot count and an **effective-from date of today or earlier**.

> **The single most common mistake.** Quota is effective-dated. A future `effectiveFrom` reads as **zero**
> for every date you can currently book, the grid shows no capacity, and the run allocates nobody. If
> booking looks broken later, come back and check this first.

The quota cannot exceed the building's real slot count from §1.1.

### 1.4 Optional — check the window — `/admin/config`

`booking.windowWeeks` (2 or 4), `booking.allocationRunDay`, `booking.allocationRunTime`,
`booking.approvalLeadDays`. Defaults are Sunday 20:00 IST, 2 weeks, 1 day lead. Leave them for a first
pass; §5.2 shows how to run the allocation on demand instead of waiting for Sunday.

---

## 2 · Register the people

Everyone except the super admin self-registers at **`/register`** and is then approved. Sign out first.

> **Use a separate browser profile per persona.** The refresh-token cookie is shared across all tabs and
> windows of one profile, so logging in as a second person silently rebinds the first tab's session — and
> up to 15 minutes later it starts returning *"Insufficient role for this operation"* from a screen that
> still looks correct. Separate profiles, or one incognito window per persona, avoids it entirely.

### 2.1 A company admin

Register with **Registering as → Company admin**, picking your company. Then as super admin approve it at
**`/admin/admin-requests`**.

Approval both activates the account *and* grants the company-admin assignment — a company admin cannot
approve another company admin.

### 2.2 Two or three employees

Register with **Registering as → Employee**, same company. Give them **different home→office distances**
— distance is 60% of the allocation score, so identical distances make the ranking dull.

Approve them as the **company admin** at **`/company/approvals`**.

### 2.3 A security guard

Register with **Registering as → Security**.

**Expect the form to collapse** to six fields: full name, registering as, email, contact number, password,
confirm password. No company, address, PIN or distance — a gate operator has no tenant to pick and no
commute to record, so the server files them under the building company itself.

Approve as **super admin** at **`/admin/admin-requests`**.

> A company admin gets **404** trying to approve a guard, not 403 — the guard belongs to the building
> company, so a tenant admin cannot even see the record.

---

## 3 · Employee — book parking

Sign in as an employee → **`/book`**.

### 3.1 The window

Check that:
- the window covers the configured number of weeks, **weekends excluded**;
- a banner names when results are published, with a live countdown;
- the earliest selectable date is at least `approvalLeadDays` after the next run.

### 3.2 Book several dates at once

Rows are **multi-select**. Click two or three; each gets a tick and the count updates. Use **Select all N
open dates** and **Clear** too. The chips under the form remove a date.

The button counts what you're about to submit — **Submit 3 requests**. The trip details (car, carpool,
special requirement) apply to **every** selected date.

Submit. **Expect an outcome panel listing each date separately.** All three should say *Submitted*.

### 3.3 Prove partial success

Submit the **same dates again**. Expect a mixed result: every date comes back *Not booked* with
*"You already have a PRIMARY booking for this date"*, and the panel reports **0 of 3**.

Now select one already-requested date plus one fresh one and submit. **Expect 1 of 2 booked** — the fresh
date succeeds, the duplicate is refused, and the successful one is *not* rolled back. That is the whole
point of the batch endpoint: one bad date never discards the others.

### 3.4 Demand is a count, not a fullness bar

Book the same date as a second employee (separate browser profile). Both succeed — **no "date is full"
refusal exists**. The row's count rises: *"12 slots · 2 requests so far"*.

Add a **carpool member** (another registered employee's email) on one request — only registered users are
accepted, and same-company members are scored.

---

## 4 · Company admin — see and shape demand

Sign in as the company admin → **`/company`**.

- **Dashboard** — the company's requests, and the unbooked-entry feed used in §6.4.
- **`/company/approvals`** — members and their statuses, plus pending **vehicle registrations** (§6.3).
- **`/company/blocks`** — block slots for a date (visitors, maintenance). Blocked slots come off the
  quota, so blocking is how you make the allocation genuinely competitive.
- **`/company/allocations`** — who got what, once a run has happened.

**Try this:** block the company down to fewer slots than there are requests for a date. Nobody is refused
at booking time; the competition simply resolves at the run in §5.

---

## 5 · Super admin — run the allocation

### 5.1 The weekly batch — `/admin/weekly-run`

Shows the band of dates the next run will decide and when it fires. Trigger it manually here. Every date
in the band gets decided in one pass.

### 5.2 A single date — `/admin/allocation`

Pick a date and **Run primary allocation**. Then **Start common pool** to share unused slots across
companies, top score first.

**Expect:**
- a ranked table — distance score, carpool score, final score, outcome, slot number;
- rank 1 highlighted;
- more requests than slots → the surplus is **WAITLISTED**, not rejected;
- re-running is **locked** — the button relabels to *"Primary allocation already done"*. A run is per date
  and must not be repeatable.

Revisit the date later: the stored results load without re-running.

### 5.3 Back on the employee's side

- **`/book`** — the decided date has flipped to **DECIDED** and shows the assigned slots; the row names
  your own slot if you won one.
- **`/my-bookings`** — history.
- **`/booking/:id`** — the score breakdown, and **Release slot** if you were allocated one and the date is
  today or later. Releasing reallocates to the waitlist automatically — own company first, then
  cross-company by score.

---

## 6 · Security — the gate

Sign in as the guard. **Expect to land on `/security` with two actions only: Check in and Check out.** No
booking, no dashboard, no admin nav.

### 6.1 A car that is known and has a booking

You need a car in the registry first — either §6.3, or import a sheet:

```bash
cd backend
npm run import:vehicles -- ./fixtures/vehicles.sample.csv --dry   # preview
npm run import:vehicles -- ./fixtures/vehicles.sample.csv
```

The importer links each car to its owner **by email**, so the CSV's email column must match a user you
actually registered. Accepted headers are flexible (`Car Number`, `Vehicle No`, `Plate`, …) — see
`backend/scripts/vehicleCsv.ts`.

Then: **Check in** → type part of the plate → pick from the typeahead → the driver's details fill in
themselves. Submit. The visit appears in today's log with a check-in time.

Plate matching is normalised, so `mh12 ab 1234` finds `MH12AB1234`.

### 6.2 Check out, and the double check-in guard

- **Check in the same car again → 409.** One open visit per car per day.
- **Check out** the car → the log row closes with a check-out time.
- Check out a car that isn't inside → **404**.
- Check-out finds the *latest open* visit, so a car that arrived before midnight still closes correctly.

### 6.3 A walk-in — register the car at the gate

Check in a plate that is in no registry at all. The guard can **submit a registration request** for it on
the spot; the barrier is never blocked waiting for paperwork.

Then approve it as **company admin** (`/company/approvals`) or **super admin**
(`/admin/admin-requests`) — a guard cannot approve their own request.

### 6.4 No booking — warn but allow (D16)

Check in a known car with **no booking for today**.

**Expect a warning, and expect the submit button to stay enabled.** The entry is recorded and flagged.
Then check the **company admin dashboard** — the entry appears in the unbooked list. That is the follow-up
trail; refusing entry is never the behaviour.

---

## 7 · Quick reference

| Persona | Sign in | Lands on |
|---|---|---|
| Super admin | your seeded email | `/admin` |
| Company admin | self-registered, SA-approved | `/company` |
| Employee | self-registered, CA-approved | `/app` |
| Security | self-registered, SA-approved | `/security` |

| Screen | Path |
|---|---|
| Slots | `/admin/slots` |
| Companies + quota | `/admin/companies` |
| Privileged approvals + vehicle registrations | `/admin/admin-requests` |
| Weekly run | `/admin/weekly-run` |
| Single-date allocation | `/admin/allocation` |
| Config | `/admin/config` |
| Member approvals + vehicle registrations | `/company/approvals` |
| Blocks | `/company/blocks` |
| Allocations | `/company/allocations` |
| Book | `/book` |
| History | `/my-bookings` |
| Booking detail / release | `/booking/:id` |
| Gate console | `/security` |

---

## 8 · When something looks broken

| Symptom | Cause |
|---|---|
| Nobody can book; grid shows no capacity | Quota `effectiveFrom` is in the future, or no quota at all. §1.3 |
| *"Not enough usable parking slots"* on a run | No slots created. §1.1 |
| *"Insufficient role for this operation"* mid-session | Two personas in one browser profile — the shared refresh cookie rebound your session. Use separate profiles. §2 |
| Employee stuck at PENDING | Company admin hasn't approved them. §2.2 |
| Guard can't be approved by the company admin (404) | By design — only the super admin can. §2.3 |
| Booking window looks too short/long | `booking.windowWeeks` / `approvalLeadDays`. §1.4 |
| Typeahead finds no car | Registry is empty — import a sheet or register a walk-in. §6.1 / §6.3 |
| Release button missing | Only shows for an ALLOCATED booking dated today or later. §5.3 |

## 9 · The automated suites

Faster than clicking, and they cover the same ground:

```bash
cd backend
npm run typecheck && npm test && npm run test:integration   # integration needs Postgres

cd ../frontend
npx tsc --noEmit && npm run lint
npm test -- --no-file-parallelism
```

> Run the frontend suite with `--no-file-parallelism`. In parallel it is flaky on a loaded machine — a
> shifting set of unrelated tests trips the 5-second timeout. Serial is green; re-run serially before
> believing a failure.

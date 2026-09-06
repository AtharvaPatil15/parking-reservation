# Sample logins (mock / dev only)

The dev app runs against **MSW mocks** (no real backend). The mock login handler
(`src/mocks/handlers.ts`) accepts **any username** and picks the role from the username
**prefix**. The **password can be anything non-empty**. These are not real accounts.

App URL: **http://localhost:5174/** (or whatever port `npm run dev` prints).

| Role | Username to enter | Password | Lands on |
|------|--------------------|----------|----------|
| **Super Admin** | `admin` | any (e.g. `password`) | `/admin` |
| **Company Admin** | `company` | any (e.g. `password`) | `/company` |
| **Security** | `security` | any (e.g. `password`) | `/security` |
| **User** | `user` | any (e.g. `password`) | `/app` |

## How the role is chosen
- username starts with `admin`    → **SUPER_ADMIN**
- username starts with `company`  → **COMPANY_ADMIN**
- username starts with `security` → **SECURITY** (Phase 7 gate operator)
- anything else                   → **USER**

So `admin1`, `companyx`, `jane` all work — only the prefix matters.

## Things to try (Phase 7)
- **Slot grid:** `/book` shows each open date with a 12-box grid — green free, grey taken/blocked, and
  your own reservation highlighted. Submitting fills a box; when a date runs out, submit is disabled
  and the row says why.
- **Next allocation run:** the booking page names the weekend run that will decide these dates, with a
  live countdown, so you can see why booking early matters.
- **Security gate:** sign in as `security…` → two big buttons. Check in `MH 12 AB 1234` (has a booking)
  vs `MH 12 CD 5678` (none — warns but still records) vs an unknown plate like `KA 05 ZZ 9999`
  (recorded too; the barrier is never blocked). Checking the same car in twice is refused.
- **Unbooked follow-up:** whatever the gate records without a booking appears on the Company Admin
  dashboard under "Entered without a booking".
- **Weekly run:** as Super Admin, `/admin` shows the band of dates the next weekend batch owns; running
  it twice is safe (the second pass reports every date as already decided).

## Things to try
- **Validation:** submit with an empty field → "Username is required." / "Password is required."; a malformed username → "Enter a valid username."
- **Wrong-role guard:** sign in as `user…`, then manually visit `/admin` → you're bounced back to `/app` (and vice-versa).
- **401 error state:** submitting with an **empty password** returns a mock 401 → the form shows "Invalid username or password."
- **Sign out:** the top-bar "Sign out" clears the session and returns you to the login page.
- **Deep-link return:** visit a guarded URL (e.g. `/app`) while signed out → you're sent to login, and after signing in you land back on that page.

## Note
When the app runs against the **live backend** (P5-13, `VITE_USE_MOCKS=false`),
these mock rules no longer apply — you'll use real seeded accounts and real
passwords instead. This file documents the MSW (mock) sign-in rules only.

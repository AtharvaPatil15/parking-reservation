# Sample logins (mock / dev only)

The dev app runs against **MSW mocks** (no real backend). The mock login handler
(`src/mocks/handlers.ts`) accepts **any email** and picks the role from the email
**prefix**. The **password can be anything non-empty**. These are not real accounts.

App URL: **http://localhost:5174/** (or whatever port `npm run dev` prints).

| Role | Email to enter | Password | Lands on |
|------|----------------|----------|----------|
| **Super Admin** | `admin@acme.test` | any (e.g. `password`) | `/admin` |
| **Company Admin** | `company@acme.test` | any (e.g. `password`) | `/company` |
| **User** | `user@acme.test` | any (e.g. `password`) | `/app` |

## How the role is chosen
- email starts with `admin@`  → **SUPER_ADMIN**
- email starts with `company@` → **COMPANY_ADMIN**
- anything else               → **USER**

So `admin@anything.com`, `company@x.io`, `jane@corp.com` all work — only the prefix matters.

## Things to try
- **Validation:** submit with an empty field → "Email is required." / "Password is required."; a malformed email → "Enter a valid email."
- **Wrong-role guard:** sign in as `user@…`, then manually visit `/admin` → you're bounced back to `/app` (and vice-versa).
- **401 error state:** submitting with an **empty password** returns a mock 401 → the form shows "Invalid email or password."
- **Sign out:** the top-bar "Sign out" clears the session and returns you to the login page.
- **Deep-link return:** visit a guarded URL (e.g. `/app`) while signed out → you're sent to login, and after signing in you land back on that page.

## Note
When the app is later wired to the **live backend** (P5-13), these mock rules no
longer apply — you'll use real seeded accounts and real passwords instead. This
file is a local testing aid and is **not committed** to the repo.

# P5-03 — Router + role guards + auth context — Design

**Date:** 2026-07-29
**Owner:** Atharva (Phase 5 — frontend)
**Task:** P5-03 (`docs/plan/phase-5-frontend.md`) · Tag: DEMO · Deps: P5-01
**Branch:** continues on the frontend branch (P5-02 committed locally at `6fefe5f`).

## Goal

From the plan AC:

> Public `/login`, `/register`; role-guarded shells `/admin/*`, `/company/*`, `/app/*`.
> `<RequireRole>` redirects wrong-role users; unauthenticated → `/login`; **token held in memory**.

Deliver client-side routing, role-based guards, and an in-memory auth context. This task builds
the routing/guard skeleton only — the real login form (P5-05) and API/React-Query layer (P5-04)
plug into it later.

## Decisions

- **Router:** `react-router-dom`, **declarative** API (`<BrowserRouter>` / `<Routes>` / `<Route>`)
  with guard wrapper components. Chosen over the v7 data-router (loaders/actions) because data
  fetching is owned by React Query in P5-04, so loaders would add complexity the plan doesn't call
  for. Matches the plan's evidence paths (`app/router.tsx`, `lib/guards.tsx`).
- **Auth persistence:** none. Token lives in memory only, per the plan AC. A hard refresh clears
  auth and bounces to `/login`. Refresh-token rotation and the auth interceptor are P5-04.
- **Role source of truth:** mirror the backend's `SUPER_ADMIN › COMPANY_ADMIN › USER`
  (`backend/src/lib/roles.ts`). The login response already carries a single resolved `role`.

## Components

### `src/lib/roles.ts`
```ts
export type Role = 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'USER';
// Landing route for a role after login / when redirected off a wrong-role page.
export function roleHome(role: Role): string; // SUPER_ADMIN→/admin, COMPANY_ADMIN→/company, USER→/app
```

### `src/lib/auth.tsx` — in-memory auth context
Shape mirrors the backend login response so P5-05 drops in without reshaping:
```ts
type AuthUser = {
  id: string; fullName: string; role: Role;
  companyId: string | null; companyName: string;
};
type AuthState = {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;                 // derived: !!accessToken
  login(session: { accessToken: string; user: AuthUser }): void;
  logout(): void;
};
```
Exports `<AuthProvider>` and `useAuth()`. P5-03 manages state only; no network calls.

### `src/lib/guards.tsx`
- **`<RequireAuth>`** — if not authenticated, `<Navigate to="/login" replace state={{ from }}/>`;
  otherwise render `<Outlet/>`. Preserves the intended path in router `state` for post-login return.
- **`<RequireRole role={Role}>`** — composes `RequireAuth`; if the user's role ≠ `role`, redirect to
  `roleHome(user.role)` (their own home, never a dead-end); otherwise render `<Outlet/>`.

Both are layout routes (render `<Outlet/>`) so child routes nest under them.

### `src/app/router.tsx`
| Path | Guard | Element |
|---|---|---|
| `/` | — | redirect: authed → `roleHome(role)`, else `/login` |
| `/login` | public | `LoginPage` placeholder (real page = P5-05) |
| `/register` | public | placeholder (no page task yet) |
| `/admin/*` | `RequireRole SUPER_ADMIN` | `AdminShell` |
| `/company/*` | `RequireRole COMPANY_ADMIN` | `CompanyShell` |
| `/app/*` | `RequireRole USER` | `UserShell` |
| `*` | — | `NotFound` |

`AppShell` (P5-02) provides the authenticated chrome (top bar / theme toggle); the three role
shells render inside it and are thin placeholders now, filled by P5-06+. `<AuthProvider>` wraps the
router in `main.tsx` (or `App.tsx`).

## Data flow

1. App boots unauthenticated → any guarded route redirects to `/login`.
2. (Later, P5-05) login page calls `useAuth().login({ accessToken, user })`.
3. `isAuthenticated` flips true → `/` and post-login redirect resolve to `roleHome(user.role)`.
4. Guarded routes render for the matching role; wrong-role access bounces to the user's own home.
5. `logout()` clears state → guards send the user back to `/login`.

## Error / edge handling

- Unauthenticated on a guarded route → `/login` (intended path kept in `state`).
- Authenticated, wrong role → own `roleHome` (no dead-ends, no infinite redirect: home is always
  a role the user can access).
- Unknown path → `NotFound`.
- Hard refresh → in-memory state lost → treated as unauthenticated (accepted, per spec).

## Testing — `src/lib/guards.test.tsx`

RTL + `MemoryRouter`, seeding auth state via `AuthProvider`:
- Unauthenticated → `/admin` lands on `/login`.
- `USER` → `/admin` bounces to `/app`.
- `SUPER_ADMIN` → `/admin` renders admin content.
- `/` redirects by role when authenticated, to `/login` when not.

Satisfies the guard-redirect slice of P5-14 early.

## Scope boundaries (YAGNI)

- No token persistence, refresh-token handling, or auth interceptor (P5-04).
- No real login form or API call (P5-05).
- Role shells are placeholders — just enough to prove guards route correctly.

## Definition of Done

- `react-router-dom` added; app routes via `router.tsx`.
- Guards redirect per the table above; token held in memory via `AuthProvider`.
- Guard-redirect tests pass; `build` ✓ · `lint` ✓ · `test` ✓.
- Plan checkbox P5-03 ticked; committed on the branch (no trailer, per repo rule).

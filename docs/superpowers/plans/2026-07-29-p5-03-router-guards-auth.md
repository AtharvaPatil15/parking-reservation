# P5-03 Router + Role Guards + Auth Context — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add client-side routing, an in-memory auth context, and role guards so the app routes users to `/admin`, `/company`, or `/app` by role and bounces wrong-role / unauthenticated access.

**Architecture:** `react-router-dom` declarative API. An `AuthProvider` holds `{ user, accessToken }` in memory and exposes `login`/`logout`. Guard layout-routes (`RequireAuth`, `RequireRole`) read that context and render `<Outlet/>` or `<Navigate/>`. `AppShell` becomes the authenticated chrome (top bar + `<Outlet/>`); public pages (`/login`, `/register`, 404) use a lighter `PublicHeader`. A temporary dev sign-in on the login page makes the guards clickable before the real login form (P5-05).

**Tech Stack:** React 18, TypeScript, Vite, `react-router-dom` ^6, Tailwind v3, Vitest + React Testing Library, jsdom.

## Global Constraints

- `react-router-dom` **^6**, **declarative API only** — `<BrowserRouter>`/`<Routes>`/`<Route>`; no data-router (`createBrowserRouter`, loaders, actions).
- Auth state is **in-memory only** — no `localStorage`/`sessionStorage`. Hard refresh = logged out. (Refresh-token handling is P5-04.)
- Roles mirror the backend exactly: `'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'USER'` (`backend/src/lib/roles.ts`).
- Route→role map: `/admin` = `SUPER_ADMIN`, `/company` = `COMPANY_ADMIN`, `/app` = `USER`.
- All work stays on branch `atharva/P5-02-component-library` (P5-02 remains local, unpushed).
- Commits: conventional (`feat(frontend):`, `refactor(frontend):`), **no `Co-Authored-By` trailer** (repo rule).
- Install fallback: if the private CodeArtifact registry returns 401, retry the install with `--registry=https://registry.npmjs.org/`.
- Import paths: `src/lib/*`, `src/app/*`, `src/features/*`, component barrel `../components`. Match existing style (named exports, JSDoc on providers, Tailwind token classes like `bg-canvas`, `text-text-muted`, `rounded-control`).

## File Structure

**Create:**
- `src/lib/roles.ts` — `Role` type + `roleHome(role)`.
- `src/lib/auth.tsx` — `AuthProvider` + `useAuth` (in-memory), `AuthUser`/`AuthSession` types.
- `src/lib/guards.tsx` — `RequireAuth`, `RequireRole` layout routes.
- `src/lib/guards.test.tsx` — guard redirect tests (headline deliverable).
- `src/app/chrome.tsx` — shared `Logo`, `ThemeToggle`, `PublicHeader` (moved out of `AppShell`).
- `src/app/router.tsx` — `AppRouter` route tree + `RootRedirect`.
- `src/app/NotFound.tsx` — 404 page.
- `src/app/router.test.tsx` — routing + guard integration test.
- `src/features/auth/LoginPage.tsx` — placeholder + temporary dev sign-in.
- `src/features/auth/RegisterPage.tsx` — placeholder.
- `src/features/superadmin/AdminShell.tsx` — `/admin` placeholder.
- `src/features/companyadmin/CompanyShell.tsx` — `/company` placeholder.
- `src/features/user/UserShell.tsx` — `/app` placeholder (renders the gallery for now).
- `src/features/dev/ComponentGallery.tsx` — the P5-02 gallery, relocated out of `AppShell`.

**Modify:**
- `src/app/AppShell.tsx` — becomes authenticated layout: top bar (with user + sign-out) + `<Outlet/>`.
- `src/app/App.tsx` — wrap with `AuthProvider` + `BrowserRouter` + `AppRouter`.
- `src/app/App.test.tsx` — update smoke tests for the new unauthenticated landing (login page).
- `package.json` — add `react-router-dom`.

---

### Task 1: Roles helper + router dependency

**Files:**
- Create: `frontend/src/lib/roles.ts`
- Test: `frontend/src/lib/roles.test.ts`
- Modify: `frontend/package.json` (via npm install)

**Interfaces:**
- Produces: `type Role = 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'USER'`; `roleHome(role: Role): string`.

- [ ] **Step 1: Install react-router-dom**

Run (from `frontend/`):
```bash
npm install react-router-dom@^6
```
If it fails with a 401/403 from the private registry, retry:
```bash
npm install react-router-dom@^6 --registry=https://registry.npmjs.org/
```
Expected: `react-router-dom` appears under `dependencies` in `frontend/package.json`.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/lib/roles.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { roleHome } from './roles';

describe('roleHome', () => {
  it('maps each role to its landing route', () => {
    expect(roleHome('SUPER_ADMIN')).toBe('/admin');
    expect(roleHome('COMPANY_ADMIN')).toBe('/company');
    expect(roleHome('USER')).toBe('/app');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- roles`
Expected: FAIL — cannot resolve `./roles`.

- [ ] **Step 4: Write the implementation**

Create `frontend/src/lib/roles.ts`:
```ts
export type Role = 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'USER';

/** Landing route for a role — used after login and when bouncing off a wrong-role page. */
export function roleHome(role: Role): string {
  switch (role) {
    case 'SUPER_ADMIN':
      return '/admin';
    case 'COMPANY_ADMIN':
      return '/company';
    case 'USER':
      return '/app';
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- roles`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/lib/roles.ts frontend/src/lib/roles.test.ts
git commit -m "feat(frontend): P5-03 add react-router-dom + role helper"
```

---

### Task 2: In-memory auth context

**Files:**
- Create: `frontend/src/lib/auth.tsx`
- Test: `frontend/src/lib/auth.test.tsx`

**Interfaces:**
- Consumes: `Role` from `./roles` (Task 1).
- Produces:
  - `interface AuthUser { id: string; fullName: string; role: Role; companyId: string | null; companyName: string }`
  - `interface AuthSession { accessToken: string; user: AuthUser }`
  - `<AuthProvider initialSession?: AuthSession | null>` — `initialSession` seeds state (tests + future hydration).
  - `useAuth(): { user: AuthUser | null; accessToken: string | null; isAuthenticated: boolean; login(s: AuthSession): void; logout(): void }`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/auth.test.tsx`:
```tsx
import { act, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthProvider, useAuth, type AuthSession } from './auth';

const session: AuthSession = {
  accessToken: 'tok',
  user: { id: '1', fullName: 'Uma User', role: 'USER', companyId: 'c1', companyName: 'Acme' },
};

describe('AuthProvider', () => {
  it('starts unauthenticated', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.accessToken).toBeNull();
  });

  it('login sets user + token, logout clears them', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    act(() => result.current.login(session));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.fullName).toBe('Uma User');
    expect(result.current.accessToken).toBe('tok');
    act(() => result.current.logout());
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('honors initialSession', () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider initialSession={session}>{children}</AuthProvider>,
    });
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('throws when used outside a provider', () => {
    function Bad() {
      useAuth();
      return null;
    }
    expect(() => render(<Bad />)).toThrow(/AuthProvider/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- auth`
Expected: FAIL — cannot resolve `./auth`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/auth.tsx`:
```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Role } from './roles';

export interface AuthUser {
  id: string;
  fullName: string;
  role: Role;
  companyId: string | null;
  companyName: string;
}

export interface AuthSession {
  accessToken: string;
  user: AuthUser;
}

interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  login: (session: AuthSession) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Holds the signed-in session in memory only (no persistence — per the P5-03 spec).
 * A hard refresh clears it; the router then redirects to /login. `initialSession`
 * lets tests (and future hydration) seed state without a login round-trip.
 */
export function AuthProvider({
  children,
  initialSession = null,
}: {
  children: ReactNode;
  initialSession?: AuthSession | null;
}) {
  const [session, setSession] = useState<AuthSession | null>(initialSession);

  const login = useCallback((next: AuthSession) => setSession(next), []);
  const logout = useCallback(() => setSession(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      accessToken: session?.accessToken ?? null,
      isAuthenticated: session !== null,
      login,
      logout,
    }),
    [session, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- auth`
Expected: PASS (4 tests). The "throws outside provider" test logs a React error to the console — that is expected.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/auth.tsx frontend/src/lib/auth.test.tsx
git commit -m "feat(frontend): P5-03 in-memory auth context"
```

---

### Task 3: Route guards (headline deliverable)

**Files:**
- Create: `frontend/src/lib/guards.tsx`
- Test: `frontend/src/lib/guards.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 2); `roleHome`, `Role` (Task 1); `react-router-dom` `Navigate`/`Outlet`/`useLocation`.
- Produces: `<RequireAuth/>` and `<RequireRole role={Role} />` — both are layout routes (render `<Outlet/>` on success, `<Navigate/>` on failure).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/guards.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthProvider, type AuthSession, type AuthUser } from './auth';
import { RequireAuth, RequireRole } from './guards';

const superAdmin: AuthUser = { id: '1', fullName: 'Sam Super', role: 'SUPER_ADMIN', companyId: null, companyName: 'HQ' };
const normalUser: AuthUser = { id: '2', fullName: 'Uma User', role: 'USER', companyId: 'c1', companyName: 'Acme' };
const sessionFor = (user: AuthUser): AuthSession => ({ accessToken: 'tok', user });

function renderAt(path: string, session: AuthSession | null) {
  return render(
    <AuthProvider initialSession={session}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<div>Login page</div>} />
          <Route path="/app" element={<div>User home</div>} />
          <Route element={<RequireRole role="SUPER_ADMIN" />}>
            <Route path="/admin" element={<div>Admin content</div>} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route path="/secure" element={<div>Secure content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('guards', () => {
  it('sends unauthenticated users on a role route to /login', () => {
    renderAt('/admin', null);
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('bounces a wrong-role user to their own home', () => {
    renderAt('/admin', sessionFor(normalUser));
    expect(screen.getByText('User home')).toBeInTheDocument();
  });

  it('renders content for the matching role', () => {
    renderAt('/admin', sessionFor(superAdmin));
    expect(screen.getByText('Admin content')).toBeInTheDocument();
  });

  it('RequireAuth blocks anonymous and allows any authenticated role', () => {
    renderAt('/secure', null);
    expect(screen.getByText('Login page')).toBeInTheDocument();
    renderAt('/secure', sessionFor(normalUser));
    expect(screen.getByText('Secure content')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- guards`
Expected: FAIL — cannot resolve `./guards`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/guards.tsx`:
```tsx
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { roleHome, type Role } from './roles';

/**
 * Gate for authenticated-only areas. Unauthenticated → /login, preserving the
 * attempted path in router state so the login page can return the user there.
 */
export function RequireAuth() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

/**
 * Gate for a specific role. Enforces auth first (→ /login), then role: a wrong-role
 * user is sent to their own home (never a dead-end, never a redirect loop).
 */
export function RequireRole({ role }: { role: Role }) {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (user.role !== role) {
    return <Navigate to={roleHome(user.role)} replace />;
  }
  return <Outlet />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- guards`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/guards.tsx frontend/src/lib/guards.test.tsx
git commit -m "feat(frontend): P5-03 role guards (RequireAuth/RequireRole)"
```

---

### Task 4: Chrome extraction + route-target components

Relocate the shared chrome and the P5-02 gallery, refactor `AppShell` into the authenticated layout, and create every component the router points at. No router yet — components are verified by rendering them directly inside `MemoryRouter` + `AuthProvider`.

**Files:**
- Create: `frontend/src/app/chrome.tsx`, `frontend/src/app/NotFound.tsx`,
  `frontend/src/features/dev/ComponentGallery.tsx`,
  `frontend/src/features/auth/LoginPage.tsx`, `frontend/src/features/auth/RegisterPage.tsx`,
  `frontend/src/features/superadmin/AdminShell.tsx`,
  `frontend/src/features/companyadmin/CompanyShell.tsx`,
  `frontend/src/features/user/UserShell.tsx`
- Modify: `frontend/src/app/AppShell.tsx`
- Test: `frontend/src/features/auth/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 2); `roleHome`, `Role`, `AuthUser` (Tasks 1–2); component barrel `../components`; `useTheme` from `../lib/theme`.
- Produces: `Logo`, `ThemeToggle`, `PublicHeader` (from `chrome.tsx`); `AppShell` (layout); `NotFound`; `ComponentGallery`; `LoginPage`; `RegisterPage`; `AdminShell`; `CompanyShell`; `UserShell`.

- [ ] **Step 1: Create the shared chrome**

Create `frontend/src/app/chrome.tsx` (moves `Logo`, `ThemeToggle`, and the sun/moon icons out of `AppShell`, and adds a public header):
```tsx
import { useTheme } from '../lib/theme';

export function Logo() {
  return (
    <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-sm font-bold text-white">
      P
    </span>
  );
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      title={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      className="grid h-8 w-8 place-items-center rounded-control border border-border bg-surface text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/** Minimal header for public pages (login / register / 404). */
export function PublicHeader() {
  return (
    <header className="border-b border-border bg-surface/80">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-base font-semibold tracking-tight">Parking Reservation</span>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2v2m0 16v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M2 12h2m16 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
```

- [ ] **Step 2: Relocate the component gallery**

Create `frontend/src/features/dev/ComponentGallery.tsx`. Move the `ComponentGallery` function and its `AllocationRow` interface, `allocationRows`, and `allocationColumns` verbatim from `AppShell.tsx` into it. Update the imports at the top of the new file:
```tsx
import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  Select,
  SuccessState,
  Table,
  useToast,
  type Column,
} from '../../components';

// ...paste AllocationRow, allocationRows, allocationColumns, and
// `export function ComponentGallery() { ... }` here, unchanged from AppShell.
```
Add `export` to `function ComponentGallery()`.

- [ ] **Step 3: Refactor AppShell into the authenticated layout**

Replace the entire contents of `frontend/src/app/AppShell.tsx` with:
```tsx
import { Outlet } from 'react-router-dom';
import { Button } from '../components';
import { useAuth } from '../lib/auth';
import { Logo, ThemeToggle } from './chrome';

/**
 * Authenticated chrome: top bar + content region. The role shells (/admin,
 * /company, /app) render through the <Outlet/>. Only mounts behind a role guard,
 * so `user` is always present here.
 */
export function AppShell() {
  return (
    <div className="min-h-screen bg-canvas text-text">
      <TopBar />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}

function TopBar() {
  const { user, logout } = useAuth();
  const initial = user?.fullName?.charAt(0).toUpperCase() ?? '?';
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-base font-semibold tracking-tight">Parking Reservation</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <span className="flex items-center gap-2 rounded-control border border-border bg-surface px-2.5 py-1 text-sm text-text-muted">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-primary-subtle text-xs font-semibold text-primary">
              {initial}
            </span>
            <span className="hidden sm:inline">{user?.fullName ?? 'Account'}</span>
          </span>
          <Button size="sm" variant="secondary" onClick={logout}>
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Create the role-shell placeholders**

Create `frontend/src/features/superadmin/AdminShell.tsx`:
```tsx
import { Card } from '../../components';
import { useAuth } from '../../lib/auth';

export function AdminShell() {
  const { user } = useAuth();
  return (
    <Card title="Super Admin">
      <p className="text-text-muted">
        Signed in as {user?.fullName}. Allocation run, config timings, and management screens land in
        P5-09–P5-11.
      </p>
    </Card>
  );
}
```

Create `frontend/src/features/companyadmin/CompanyShell.tsx`:
```tsx
import { Card } from '../../components';
import { useAuth } from '../../lib/auth';

export function CompanyShell() {
  const { user } = useAuth();
  return (
    <Card title="Company Admin">
      <p className="text-text-muted">
        Signed in as {user?.fullName} ({user?.companyName}). Approvals, blocks, and the company
        dashboard land in P5-12.
      </p>
    </Card>
  );
}
```

Create `frontend/src/features/user/UserShell.tsx` (renders the gallery as temporary user-area content until P5-06+ replace it):
```tsx
import { ComponentGallery } from '../dev/ComponentGallery';

/** Temporary: shows the P5-02 component gallery. Replaced by the booking
 *  form / dashboard in P5-06–P5-08. */
export function UserShell() {
  return <ComponentGallery />;
}
```

- [ ] **Step 5: Create the auth pages + 404**

Create `frontend/src/features/auth/LoginPage.tsx`:
```tsx
import { useNavigate } from 'react-router-dom';
import { Button, Card } from '../../components';
import { PublicHeader } from '../../app/chrome';
import { useAuth, type AuthUser } from '../../lib/auth';
import { roleHome, type Role } from '../../lib/roles';

// TEMPORARY dev identities so guards/routing are clickable before the real login
// form + useLogin arrive in P5-05. Delete this block and the "Developer sign-in"
// card when P5-05 lands.
const DEV_USERS: Record<Role, AuthUser> = {
  SUPER_ADMIN: { id: 'dev-super', fullName: 'Dev Super Admin', role: 'SUPER_ADMIN', companyId: null, companyName: 'Platform' },
  COMPANY_ADMIN: { id: 'dev-company', fullName: 'Dev Company Admin', role: 'COMPANY_ADMIN', companyId: 'dev-co', companyName: 'Acme Co' },
  USER: { id: 'dev-user', fullName: 'Dev User', role: 'USER', companyId: 'dev-co', companyName: 'Acme Co' },
};

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  function devSignIn(role: Role) {
    login({ accessToken: 'dev-token', user: DEV_USERS[role] });
    navigate(roleHome(role), { replace: true });
  }

  return (
    <div className="min-h-screen bg-canvas text-text">
      <PublicHeader />
      <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-text-muted">The real login form arrives in P5-05.</p>
        </div>
        <Card title="Developer sign-in" description="Temporary — pick a role to exercise the routing and guards.">
          <div className="flex flex-col gap-3">
            <Button onClick={() => devSignIn('SUPER_ADMIN')}>Sign in as Super Admin</Button>
            <Button variant="secondary" onClick={() => devSignIn('COMPANY_ADMIN')}>
              Sign in as Company Admin
            </Button>
            <Button variant="secondary" onClick={() => devSignIn('USER')}>
              Sign in as User
            </Button>
          </div>
        </Card>
      </main>
    </div>
  );
}
```

Create `frontend/src/features/auth/RegisterPage.tsx`:
```tsx
import { Link } from 'react-router-dom';
import { PublicHeader } from '../../app/chrome';

export function RegisterPage() {
  return (
    <div className="min-h-screen bg-canvas text-text">
      <PublicHeader />
      <main className="mx-auto flex max-w-md flex-col gap-4 px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
        <p className="text-text-muted">Registration is not built yet.</p>
        <Link to="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </main>
    </div>
  );
}
```

Create `frontend/src/app/NotFound.tsx`:
```tsx
import { Link } from 'react-router-dom';
import { PublicHeader } from './chrome';

export function NotFound() {
  return (
    <div className="min-h-screen bg-canvas text-text">
      <PublicHeader />
      <main className="mx-auto flex max-w-md flex-col items-start gap-4 px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-text-muted">That page doesn’t exist.</p>
        <Link to="/" className="text-primary hover:underline">
          Go home
        </Link>
      </main>
    </div>
  );
}
```

- [ ] **Step 6: Write the LoginPage render test**

Create `frontend/src/features/auth/LoginPage.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../../lib/auth';
import { ThemeProvider } from '../../lib/theme';
import { LoginPage } from './LoginPage';

describe('LoginPage', () => {
  it('renders the sign-in heading and the temporary dev sign-in buttons', () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter>
            <LoginPage />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>,
    );
    // Exact match: /sign in/i alone also matches the "Developer sign-in" card title.
    expect(screen.getByRole('heading', { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in as super admin/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in as company admin/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in as user/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run the test suite + lint**

Run: `npm test -- LoginPage` → Expected: PASS.
Run: `npm run lint` → Expected: 0 errors. (`react-refresh/only-export-components` may warn on `auth.tsx` — same benign warning already accepted on the P5-02 providers.)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/chrome.tsx frontend/src/app/AppShell.tsx frontend/src/app/NotFound.tsx frontend/src/features
git commit -m "refactor(frontend): P5-03 chrome + route-target placeholders"
```

---

### Task 5: Router wiring + app integration

Wire the route tree, mount providers in `App`, update the smoke test, and add the end-to-end guard test. This task ties everything together and runs the full verification gate.

**Files:**
- Create: `frontend/src/app/router.tsx`, `frontend/src/app/router.test.tsx`
- Modify: `frontend/src/app/App.tsx`, `frontend/src/app/App.test.tsx`

**Interfaces:**
- Consumes: `RequireRole` (Task 3); `useAuth`, `roleHome` (Tasks 1–2); all route-target components (Task 4); `react-router-dom` `BrowserRouter`/`Routes`/`Route`/`Navigate`.
- Produces: `AppRouter` (the `<Routes>` tree); `App` mounts `ThemeProvider → AuthProvider → ToastProvider → BrowserRouter → AppRouter`.

- [ ] **Step 1: Create the router**

Create `frontend/src/app/router.tsx`:
```tsx
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { roleHome } from '../lib/roles';
import { RequireRole } from '../lib/guards';
import { AppShell } from './AppShell';
import { NotFound } from './NotFound';
import { LoginPage } from '../features/auth/LoginPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { AdminShell } from '../features/superadmin/AdminShell';
import { CompanyShell } from '../features/companyadmin/CompanyShell';
import { UserShell } from '../features/user/UserShell';

/** `/` → the signed-in user's home, or /login when anonymous. */
function RootRedirect() {
  const { isAuthenticated, user } = useAuth();
  return <Navigate to={isAuthenticated && user ? roleHome(user.role) : '/login'} replace />;
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route element={<RequireRole role="SUPER_ADMIN" />}>
        <Route element={<AppShell />}>
          <Route path="/admin/*" element={<AdminShell />} />
        </Route>
      </Route>

      <Route element={<RequireRole role="COMPANY_ADMIN" />}>
        <Route element={<AppShell />}>
          <Route path="/company/*" element={<CompanyShell />} />
        </Route>
      </Route>

      <Route element={<RequireRole role="USER" />}>
        <Route element={<AppShell />}>
          <Route path="/app/*" element={<UserShell />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
```

- [ ] **Step 2: Wire providers in App**

Replace the contents of `frontend/src/app/App.tsx` with:
```tsx
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from '../lib/theme';
import { AuthProvider } from '../lib/auth';
import { ToastProvider } from '../components';
import { AppRouter } from './router';

/**
 * Root of the frontend. Wires the app-wide providers (theme, auth, toasts) and the
 * router. The query/API providers (P5-04) slot in around AppRouter in their own task.
 */
export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <AppRouter />
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 3: Update the App smoke test**

Replace the contents of `frontend/src/app/App.test.tsx` with:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

// Smoke test — unauthenticated boot lands on the login page.
describe('App', () => {
  it('shows the login page when unauthenticated', () => {
    render(<App />);
    // Exact match: /sign in/i alone also matches the "Developer sign-in" card title.
    expect(screen.getByRole('heading', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('exposes a theme toggle', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /switch to .* theme/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Write the routing integration test**

Create `frontend/src/app/router.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('routing + guards (integration)', () => {
  it('dev sign-in as Super Admin lands on the admin area with a sign-out control', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: /sign in as super admin/i }));
    expect(await screen.findByRole('heading', { name: /^super admin$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('signing out returns to the login page', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: /sign in as user/i }));
    expect(await screen.findByRole('button', { name: /sign out/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    // Exact match: /sign in/i alone also matches the "Developer sign-in" card title.
    expect(await screen.findByRole('heading', { name: /^sign in$/i })).toBeInTheDocument();
  });
});
```
Note: `AdminShell` renders its "Super Admin" title through `Card`, which emits an `<h2>` (confirmed in `components/Card.tsx:23`), so the `heading` role resolves. The `/^super admin$/i` exact match avoids colliding with the TopBar's "Dev Super Admin" user label (which is a `<span>`, not a heading, so it is already excluded).

- [ ] **Step 5: Run the full verification gate**

Run (from `frontend/`):
```bash
npm run build
npm run lint
npm test
```
Expected: build ✓; lint 0 errors (benign `react-refresh` warning on `auth.tsx` allowed); all tests pass (roles, auth, guards, LoginPage, App, router).

- [ ] **Step 6: Manual browser check (optional but recommended)**

Run `npm run dev`, open the served URL. Expected flow: land on **/login** → click **Sign in as Super Admin** → routed to **/admin** ("Super Admin" card) → manually visit **/app** → bounced back to **/admin** → click **Sign out** → back to **/login**.

- [ ] **Step 7: Tick the plan checkbox**

In `docs/plan/phase-5-frontend.md`, change the P5-03 status line (line ~29) from `- **Status:** ☐` to:
```
- **Status:** ☑ (react-router-dom v6 declarative; in-memory AuthProvider/useAuth; RequireAuth/RequireRole guards; /login,/register public + /admin,/company,/app role-guarded shells; temp dev sign-in; guard + integration tests; build/lint/test green)
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/router.tsx frontend/src/app/router.test.tsx frontend/src/app/App.tsx frontend/src/app/App.test.tsx docs/plan/phase-5-frontend.md
git commit -m "feat(frontend): P5-03 router + role-guarded shells + auth wiring"
```

---

## Self-Review

**Spec coverage:**
- Public `/login`, `/register` → Task 4 (pages) + Task 5 (routes). ✓
- Role-guarded `/admin/*`, `/company/*`, `/app/*` → Task 5 router + Task 4 shells. ✓
- `<RequireRole>` redirects wrong-role users → Task 3 (test: USER→/admin bounces to /app). ✓
- Unauthenticated → `/login` → Task 3 (RequireAuth/RequireRole) + RootRedirect. ✓
- Token held in memory → Task 2 (`AuthProvider`, no persistence). ✓
- Evidence paths `app/router.tsx`, `lib/guards.tsx` → created in Tasks 5 and 3. ✓
- Guard-redirect tests (P5-14 slice) → Task 3 `guards.test.tsx` + Task 5 integration. ✓

**Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"; all code blocks are complete. The only "placeholder" is intentional product scope (role-shell UIs deferred to later tasks), with the temporary dev sign-in explicitly flagged for removal in P5-05.

**Type consistency:** `Role`, `roleHome`, `AuthUser`, `AuthSession`, `useAuth`, `RequireAuth`, `RequireRole`, `AppRouter` names/signatures are consistent across Tasks 1→5. `AuthProvider` gains the optional `initialSession` prop in Task 2 and it is used by the Task 3 guard tests. The `Card`-title-as-heading assumption is flagged in Task 5 Step 4 with a fallback assertion.

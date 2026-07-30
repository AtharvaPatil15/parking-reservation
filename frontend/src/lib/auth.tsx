import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { registerUnauthorizedHandler, setAccessToken } from '../api/client';
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

// The session is persisted to sessionStorage so a hard refresh keeps the user signed in (the
// in-memory-only approach dropped it). sessionStorage (not localStorage) so it clears when the tab
// closes — a reasonable balance for a short-lived access token. The HttpOnly refresh cookie remains
// the durable credential; on load we best-effort rotate the access token from it (below).
const SESSION_KEY = 'auth:session';
function readStoredSession(): AuthSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AuthSession;
    return s?.accessToken && s?.user ? s : null;
  } catch {
    return null;
  }
}
function writeStoredSession(s: AuthSession | null): void {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable (private mode / SSR) */
  }
}

/**
 * Holds the signed-in session, mirrored into sessionStorage so a page refresh restores it
 * immediately (no logout flash, no dependency on a network round-trip). The token is primed into
 * the API client synchronously during render so the first cold-load request carries it.
 * `initialSession` lets tests seed state directly (and takes precedence over storage).
 */
export function AuthProvider({
  children,
  initialSession = null,
}: {
  children: ReactNode;
  initialSession?: AuthSession | null;
}) {
  const [session, setSession] = useState<AuthSession | null>(() => {
    const initial = initialSession ?? readStoredSession();
    // Prime the client token synchronously during the first render — BEFORE children mount and
    // fire their data queries — so a cold-load (page refresh) request isn't sent token-less and
    // 401'd, which the unauthorized handler would treat as a logout. The mirroring effect below
    // keeps it in sync on subsequent session changes.
    if (initial) setAccessToken(initial.accessToken);
    return initial;
  });

  // Set the client token synchronously so the first authenticated request after login
  // (e.g. the dashboard fetch) carries Authorization — the mirroring effect below runs
  // child-first, i.e. after the destination page's data-fetch effect, which would race.
  // Persist to sessionStorage so a page refresh restores the session.
  const login = useCallback((next: AuthSession) => {
    setAccessToken(next.accessToken);
    writeStoredSession(next);
    setSession(next);
  }, []);
  const logout = useCallback(() => {
    setAccessToken(null);
    writeStoredSession(null);
    setSession(null);
  }, []);

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

  // Mirror the in-memory token into the API client so requests carry Authorization.
  useEffect(() => {
    setAccessToken(session?.accessToken ?? null);
  }, [session]);

  // A 401 on any authenticated request logs the user out (guards then redirect to /login).
  useEffect(() => {
    registerUnauthorizedHandler(logout);
    return () => registerUnauthorizedHandler(null);
  }, [logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

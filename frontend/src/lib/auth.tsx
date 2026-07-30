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

  // Set the client token synchronously so the first authenticated request after login
  // (e.g. the dashboard fetch) carries Authorization — the mirroring effect below runs
  // child-first, i.e. after the destination page's data-fetch effect, which would race.
  const login = useCallback((next: AuthSession) => {
    setAccessToken(next.accessToken);
    setSession(next);
  }, []);
  const logout = useCallback(() => {
    setAccessToken(null);
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

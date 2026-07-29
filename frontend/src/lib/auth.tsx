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

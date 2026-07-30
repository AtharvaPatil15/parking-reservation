import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, registerUnauthorizedHandler, setAccessToken } from '../api/client';
import { unwrap } from '../api/http';
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
  /** True while the session is being restored from the refresh cookie on cold load. */
  isLoading: boolean;
  login: (session: AuthSession) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// A non-sensitive "a session existed" hint (NOT the token — that stays in memory per F10).
// It lets a cold load know whether to attempt a silent refresh, so truly-anonymous visits
// skip the network round-trip and stay synchronous.
const ACTIVE_FLAG = 'auth:active';
function hasActiveFlag(): boolean {
  try {
    return localStorage.getItem(ACTIVE_FLAG) === '1';
  } catch {
    return false;
  }
}
function setActiveFlag(on: boolean): void {
  try {
    if (on) localStorage.setItem(ACTIVE_FLAG, '1');
    else localStorage.removeItem(ACTIVE_FLAG);
  } catch {
    /* storage unavailable (private mode / SSR) — refresh-cookie flow still works within a load */
  }
}

/**
 * Re-mint a session from the HttpOnly refresh cookie (F10): rotate a fresh access token via
 * `POST /auth/refresh`, then load the profile via `GET /me`. Returns null if there is no valid
 * cookie (or the calls fail), leaving the caller to fall back to the anonymous state.
 */
async function restoreSession(): Promise<AuthSession | null> {
  try {
    const { accessToken } = await unwrap<{ accessToken: string }>(api.POST('/auth/refresh', {}));
    if (!accessToken) return null;
    setAccessToken(accessToken); // so the /me call below is authorized
    const me = await unwrap<AuthUser & { companyId: string | null }>(api.GET('/me', {}));
    return {
      accessToken,
      user: {
        id: me.id,
        fullName: me.fullName,
        role: me.role,
        companyId: me.companyId,
        companyName: me.companyName,
      },
    };
  } catch {
    setAccessToken(null);
    return null;
  }
}

/**
 * Holds the signed-in session in memory; the access token never touches storage (F10). A hard
 * refresh drops it, so on cold load we silently rehydrate from the HttpOnly refresh cookie when a
 * prior session is hinted by `auth:active`. `initialSession` lets tests seed state directly
 * (which also skips rehydration).
 */
export function AuthProvider({
  children,
  initialSession = null,
}: {
  children: ReactNode;
  initialSession?: AuthSession | null;
}) {
  const [session, setSession] = useState<AuthSession | null>(initialSession);
  // Only "loading" when we have a reason to rehydrate (unseeded + a prior-session hint).
  const [isLoading, setIsLoading] = useState<boolean>(initialSession === null && hasActiveFlag());

  const login = useCallback((next: AuthSession) => {
    setActiveFlag(true);
    setSession(next);
  }, []);
  const logout = useCallback(() => {
    setActiveFlag(false);
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      accessToken: session?.accessToken ?? null,
      isAuthenticated: session !== null,
      isLoading,
      login,
      logout,
    }),
    [session, isLoading, login, logout],
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

  // One-time silent rehydration on cold load — skipped when seeded or when no prior session hint.
  useEffect(() => {
    if (initialSession !== null || !hasActiveFlag()) return;
    let cancelled = false;
    void (async () => {
      const restored = await restoreSession();
      if (cancelled) return;
      if (restored) setSession(restored);
      else setActiveFlag(false);
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // initialSession is stable for a given mount; run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

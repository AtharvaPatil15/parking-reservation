/**
 * Typed API client — generated types (`./types`) + openapi-fetch runtime.
 * Regenerate types after any contract change: `npm run gen:types`.
 */
import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './types';

// Vite injects VITE_API_BASE_URL; fall back to the dev proxy path.
const baseUrl =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL) ||
  '/api/v1';

// In-memory access token (refresh token rides in the HttpOnly cookie).
let accessToken: string | null = null;
// Advanced on logout. A refresh that resolves AFTER the user has left carries a stale generation, so
// it must not reinstate a token or replay a request against a session that no longer exists.
let sessionGeneration = 0;
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/**
 * Clear the token and advance the session generation — called by the auth layer on logout. Any
 * refresh already in flight becomes a no-op instead of silently resurrecting the signed-out session.
 */
export function clearSession(): void {
  accessToken = null;
  sessionGeneration += 1;
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;
const AUTH_SESSION_KEY = 'auth:session';
const AUTH_UNAUTHORIZED_EVENT = 'auth:unauthorized';

function notifyUnauthorized(): void {
  accessToken = null;
  sessionGeneration += 1;
  try {
    sessionStorage.removeItem(AUTH_SESSION_KEY);
  } catch {
    /* storage unavailable */
  }
  onUnauthorized?.();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
  }
}

/** Register a callback fired when an authenticated request stays 401 after a refresh attempt fails. */
export function registerUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  onUnauthorized = fn;
}

type TokenRefreshedHandler = (token: string) => void;
let onTokenRefreshed: TokenRefreshedHandler | null = null;

/** Register a callback fired with a freshly-rotated access token so the auth layer can persist it. */
export function registerTokenRefreshedHandler(fn: TokenRefreshedHandler | null): void {
  onTokenRefreshed = fn;
}

/**
 * Single-flight silent refresh: rotate the short-lived access token from the HttpOnly refresh
 * cookie via POST /auth/refresh. Concurrent 401s (e.g. a dashboard firing several queries) share
 * one round-trip. Returns the new token, or null when the refresh cookie is gone/expired.
 */
let refreshInFlight: Promise<string | null> | null = null;
async function doRefresh(): Promise<string | null> {
  const gen = sessionGeneration; // snapshot: discard the result if the user logs out mid-flight.
  try {
    const res = await fetch(`${baseUrl}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { accessToken?: string } };
    const token = body?.data?.accessToken ?? null;
    // If logout ran while the refresh was in flight, drop the token — don't resurrect the session.
    if (gen !== sessionGeneration) return null;
    if (token) {
      setAccessToken(token);
      onTokenRefreshed?.(token);
    }
    return token;
  } catch {
    return null;
  }
}
function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/**
 * Proactively rotate the access token (called by the scheduled pre-expiry refresh in the auth
 * layer). Shares the same single-flight round-trip as the reactive 401 path. Resolves to the new
 * token, or null if the refresh cookie is gone/expired.
 */
export function refreshSession(): Promise<string | null> {
  return refreshAccessToken();
}

// openapi-fetch tags each request with a stable `id` shared between onRequest and onResponse/onError.
// We stash a pre-dispatch clone under that id so a recoverable 401 can be replayed WITH ITS BODY —
// request.clone() AFTER dispatch throws for POST/PATCH/DELETE (the body stream is already consumed).
const pendingRequests = new Map<string, Request>();

const authMiddleware: Middleware = {
  async onRequest({ request, id }) {
    if (accessToken) request.headers.set('Authorization', `Bearer ${accessToken}`);
    // Clone now, while the body is still intact, so onResponse can rebuild the request for a replay.
    pendingRequests.set(id, request.clone());
    return request;
  },
  async onResponse({ request, response, id }) {
    const original = pendingRequests.get(id);
    pendingRequests.delete(id);

    // Only an expired-token 401 on a real endpoint is recoverable. A 401 from /auth/* (bad creds,
    // dead refresh cookie) is terminal and must not loop back into a refresh.
    if (response.status !== 401 || new URL(request.url).pathname.includes('/auth/')) {
      return response;
    }
    // Silently rotate the access token, then replay the request once with it — so a token that
    // expired mid-session doesn't bounce the user to /login. Only if the refresh itself fails do
    // we treat the session as over.
    const token = await refreshAccessToken();
    if (!token) {
      notifyUnauthorized();
      return response;
    }
    // Rebuild the retry from the pre-dispatch clone (method + headers + body intact). The stored
    // clone hasn't been dispatched, so cloning it again is safe even for mutations.
    let retry: Request;
    try {
      retry = (original ?? request).clone();
    } catch {
      // No usable clone (body consumed and nothing stored) — can't safely replay. The token is now
      // refreshed, so the caller's next attempt will carry it and succeed.
      return response;
    }
    retry.headers.set('Authorization', `Bearer ${token}`);
    let retryResponse: Response;
    try {
      retryResponse = await fetch(retry);
    } catch {
      return response;
    }
    // If the replay STILL 401s, the session is genuinely dead (e.g. the account was disabled). Surface
    // it as a logout rather than handing the caller a silent, broken 401 while the app looks signed-in.
    if (retryResponse.status === 401) {
      notifyUnauthorized();
    }
    return retryResponse;
  },
  onError({ id }) {
    // Network failure — no response will reach onResponse, so drop the stored clone here to avoid a leak.
    pendingRequests.delete(id);
  },
};

export const api = createClient<paths>({ baseUrl, credentials: 'include' });
api.use(authMiddleware);

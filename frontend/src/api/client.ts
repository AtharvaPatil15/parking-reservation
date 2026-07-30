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
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

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
  try {
    const res = await fetch(`${baseUrl}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { accessToken?: string } };
    const token = body?.data?.accessToken ?? null;
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

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    if (accessToken) request.headers.set('Authorization', `Bearer ${accessToken}`);
    return request;
  },
  async onResponse({ request, response }) {
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
      onUnauthorized?.();
      return response;
    }
    let retry: Request;
    try {
      // clone() preserves method + body; it throws if the body was already consumed (mutations),
      // in which case we skip the replay — the token is refreshed, so the next action succeeds.
      retry = request.clone();
    } catch {
      return response;
    }
    retry.headers.set('Authorization', `Bearer ${token}`);
    try {
      return await fetch(retry);
    } catch {
      return response;
    }
  },
};

export const api = createClient<paths>({ baseUrl, credentials: 'include' });
api.use(authMiddleware);

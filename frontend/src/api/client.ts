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

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    if (accessToken) request.headers.set('Authorization', `Bearer ${accessToken}`);
    return request;
  },
};

export const api = createClient<paths>({ baseUrl, credentials: 'include' });
api.use(authMiddleware);

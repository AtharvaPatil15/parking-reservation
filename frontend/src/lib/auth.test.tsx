import { act, render, renderHook } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { queryClient } from '../api/queryClient';
import { server } from '../mocks/node';
import { AuthProvider, useAuth, type AuthSession } from './auth';

const session: AuthSession = {
  accessToken: 'tok',
  user: { id: '1', fullName: 'Uma User', role: 'USER', companyId: 'c1', companyName: 'Acme' },
};

// Build a JWT-shaped token whose payload carries `exp` (seconds) so the proactive-refresh effect,
// which reads that claim, schedules a pre-expiry timer. Only the payload segment needs to decode.
function makeJwt(expSeconds: number): string {
  const payload = btoa(JSON.stringify({ exp: expSeconds }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.sig`;
}

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

  it('restores a persisted session on cold load (survives a page refresh)', () => {
    // Simulate a refresh: a prior login left the session in sessionStorage.
    sessionStorage.setItem('auth:session', JSON.stringify(session));
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.fullName).toBe('Uma User');
    expect(result.current.accessToken).toBe('tok');
  });

  it('persists the session to storage on login and clears it on logout', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    act(() => result.current.login(session));
    expect(sessionStorage.getItem('auth:session')).toContain('Uma User');
    act(() => result.current.logout());
    expect(sessionStorage.getItem('auth:session')).toBeNull();
  });

  it('bridges the access token into the API client after login', async () => {
    let seen: string | null = null;
    server.use(
      http.get('/api/v1/config', ({ request }) => {
        seen = request.headers.get('Authorization');
        return HttpResponse.json({ success: true, data: [] });
      }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    act(() => result.current.login(session));
    await api.GET('/config', {});
    expect(seen).toBe('Bearer tok');
  });

  it('clears the query cache on login and on logout to prevent cross-user data bleed', () => {
    queryClient.setQueryData(['dashboard', 'user'], { stale: 'prev-user' });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    act(() => result.current.login(session));
    expect(queryClient.getQueryData(['dashboard', 'user'])).toBeUndefined();

    queryClient.setQueryData(['me'], { id: 'prev' });
    act(() => result.current.logout());
    expect(queryClient.getQueryData(['me'])).toBeUndefined();
  });

  it('proactively refreshes the access token just before it expires (no reactive 401 needed)', async () => {
    vi.useFakeTimers();
    try {
      const now = 1_700_000_000_000;
      vi.setSystemTime(now);
      const exp = Math.floor(now / 1000) + 90; // expires in 90s → timer fires at 90 − 60 (skew) = 30s
      let refreshCalls = 0;
      server.use(
        http.post('*/api/v1/auth/refresh', () => {
          refreshCalls += 1;
          return HttpResponse.json({
            success: true,
            data: { accessToken: makeJwt(Math.floor(now / 1000) + 900), tokenType: 'Bearer', expiresIn: 900 },
          });
        }),
      );
      const { result } = renderHook(() => useAuth(), {
        wrapper: ({ children }) => (
          <AuthProvider initialSession={{ ...session, accessToken: makeJwt(exp) }}>{children}</AuthProvider>
        ),
      });
      queryClient.setQueryData(['me'], { id: 'same-user' });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      expect(refreshCalls).toBe(1);
      expect(result.current.isAuthenticated).toBe(true); // rotated silently - still signed in
      expect(queryClient.getQueryData(['me'])).toEqual({ id: 'same-user' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs out when the proactive pre-expiry refresh fails', async () => {
    vi.useFakeTimers();
    try {
      const now = 1_700_000_000_000;
      vi.setSystemTime(now);
      const exp = Math.floor(now / 1000) + 90;
      server.use(
        http.post('*/api/v1/auth/refresh', () =>
          HttpResponse.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'dead cookie' } }, { status: 401 }),
        ),
      );
      const { result } = renderHook(() => useAuth(), {
        wrapper: ({ children }) => (
          <AuthProvider initialSession={{ ...session, accessToken: makeJwt(exp) }}>{children}</AuthProvider>
        ),
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      expect(result.current.isAuthenticated).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

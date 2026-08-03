import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../mocks/node';
import { api, registerUnauthorizedHandler, setAccessToken } from './client';

afterEach(() => {
  registerUnauthorizedHandler(null);
  setAccessToken(null);
});

describe('client 401 handling', () => {
  it('fires the unauthorized handler on a 401 from a non-auth endpoint', async () => {
    const onUnauth = vi.fn();
    registerUnauthorizedHandler(onUnauth);
    server.use(
      http.get('*/api/v1/config', () =>
        HttpResponse.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'expired' } }, { status: 401 }),
      ),
    );
    await api.GET('/config', {});
    expect(onUnauth).toHaveBeenCalledTimes(1);
  });

  it('silently refreshes and retries once on a 401, without logging out', async () => {
    const onUnauth = vi.fn();
    registerUnauthorizedHandler(onUnauth);
    let configCalls = 0;
    server.use(
      http.post('*/api/v1/auth/refresh', () =>
        HttpResponse.json({ success: true, data: { accessToken: 'fresh-token', tokenType: 'Bearer', expiresIn: 900 } }),
      ),
      http.get('*/api/v1/config', () => {
        configCalls += 1;
        // First hit: token expired. After the silent refresh, the replay succeeds.
        return configCalls === 1
          ? HttpResponse.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'expired' } }, { status: 401 })
          : HttpResponse.json({ success: true, data: [] });
      }),
    );
    const res = await api.GET('/config', {});
    expect(onUnauth).not.toHaveBeenCalled();
    expect(configCalls).toBe(2); // original + one retry
    expect(res.error).toBeUndefined();
  });

  it('logs out when the refresh itself fails (dead refresh cookie)', async () => {
    const onUnauth = vi.fn();
    registerUnauthorizedHandler(onUnauth);
    server.use(
      http.post('*/api/v1/auth/refresh', () =>
        HttpResponse.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'no cookie' } }, { status: 401 }),
      ),
      http.get('*/api/v1/config', () =>
        HttpResponse.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'expired' } }, { status: 401 }),
      ),
    );
    await api.GET('/config', {});
    expect(onUnauth).toHaveBeenCalledTimes(1);
  });

  it('clears persisted auth state when refresh cannot recover a 401', async () => {
    sessionStorage.setItem('auth:session', JSON.stringify({ accessToken: 'stale-token', user: { id: '1' } }));
    server.use(
      http.post('*/api/v1/auth/refresh', () =>
        HttpResponse.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'no cookie' } }, { status: 401 }),
      ),
      http.get('*/api/v1/config', () =>
        HttpResponse.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Missing bearer token' } }, { status: 401 }),
      ),
    );
    await api.GET('/config', {});
    expect(sessionStorage.getItem('auth:session')).toBeNull();
  });

  it('does NOT fire the handler on a 401 from an /auth/ endpoint (login failure is a form error)', async () => {
    const onUnauth = vi.fn();
    registerUnauthorizedHandler(onUnauth);
    server.use(
      http.post('*/api/v1/auth/login', () =>
        HttpResponse.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'bad creds' } }, { status: 401 }),
      ),
    );
    await api.POST('/auth/login', { body: { email: 'x@y.z', password: 'no' } });
    expect(onUnauth).not.toHaveBeenCalled();
  });

  it('replays a mutation (POST) WITH ITS BODY after a silent refresh — the action is not lost', async () => {
    // Regression: request.clone() after dispatch throws for a consumed body, so the old code dropped
    // the mutation on a 401 and returned a raw error. The retry must carry the original body.
    const onUnauth = vi.fn();
    registerUnauthorizedHandler(onUnauth);
    let slotCalls = 0;
    const seenBodies: unknown[] = [];
    server.use(
      http.post('*/api/v1/auth/refresh', () =>
        HttpResponse.json({ success: true, data: { accessToken: 'fresh-token', tokenType: 'Bearer', expiresIn: 900 } }),
      ),
      http.post('*/api/v1/slots', async ({ request }) => {
        slotCalls += 1;
        seenBodies.push(await request.json());
        return slotCalls === 1
          ? HttpResponse.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'expired' } }, { status: 401 })
          : HttpResponse.json({ success: true, data: { id: 'slot-1' } });
      }),
    );
    const body = {
      slotNumber: 'A-1',
      parkingAreaId: 'area-1',
      slotType: 'STANDARD' as const,
      hasEvCharging: false,
      isAccessible: false,
    };
    const res = await api.POST('/slots', { body });
    expect(onUnauth).not.toHaveBeenCalled();
    expect(slotCalls).toBe(2); // original + replay
    expect(seenBodies[1]).toEqual(body); // replay carried the SAME body
    expect(res.error).toBeUndefined();
  });

  it('logs out when the replayed request ALSO 401s (session genuinely dead)', async () => {
    // Regression: the old code returned the retry response even when it was another 401, leaving the
    // app "logged in" while every request failed. A 401 on the replay must surface as a logout.
    const onUnauth = vi.fn();
    registerUnauthorizedHandler(onUnauth);
    server.use(
      http.post('*/api/v1/auth/refresh', () =>
        HttpResponse.json({ success: true, data: { accessToken: 'fresh-token', tokenType: 'Bearer', expiresIn: 900 } }),
      ),
      http.get('*/api/v1/config', () =>
        HttpResponse.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'still expired' } }, { status: 401 }),
      ),
    );
    await api.GET('/config', {});
    expect(onUnauth).toHaveBeenCalledTimes(1);
  });

  it('shares a single refresh round-trip across concurrent 401s (single-flight)', async () => {
    const onUnauth = vi.fn();
    registerUnauthorizedHandler(onUnauth);
    let refreshCalls = 0;
    let configCalls = 0;
    let areaCalls = 0;
    server.use(
      http.post('*/api/v1/auth/refresh', () => {
        refreshCalls += 1;
        return HttpResponse.json({ success: true, data: { accessToken: 'fresh-token', tokenType: 'Bearer', expiresIn: 900 } });
      }),
      http.get('*/api/v1/config', () => {
        configCalls += 1;
        return configCalls === 1
          ? HttpResponse.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'expired' } }, { status: 401 })
          : HttpResponse.json({ success: true, data: [] });
      }),
      http.get('*/api/v1/parking-areas', () => {
        areaCalls += 1;
        return areaCalls === 1
          ? HttpResponse.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'expired' } }, { status: 401 })
          : HttpResponse.json({ success: true, data: [] });
      }),
    );
    await Promise.all([api.GET('/config', {}), api.GET('/parking-areas', {})]);
    expect(refreshCalls).toBe(1); // both 401s shared one refresh
    expect(onUnauth).not.toHaveBeenCalled();
  });
});

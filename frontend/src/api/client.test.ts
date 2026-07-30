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
});

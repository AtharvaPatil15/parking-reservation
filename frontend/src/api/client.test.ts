import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../mocks/node';
import { api, registerUnauthorizedHandler } from './client';

afterEach(() => registerUnauthorizedHandler(null));

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

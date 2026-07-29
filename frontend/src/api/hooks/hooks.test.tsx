import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '../../mocks/node';
import { AuthProvider } from '../../lib/auth';
import { ApiError } from '../http';
import { useConfig, useLogin } from './index';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

describe('hooks (against MSW)', () => {
  it('useLogin resolves to a session for valid credentials', async () => {
    const { result } = renderHook(() => useLogin(), { wrapper });
    const data = await result.current.mutateAsync({ email: 'admin@x.test', password: 'pw' });
    expect(data.user.role).toBe('SUPER_ADMIN');
    expect(data.accessToken).toBe('mock-access-token');
  });

  it('useLogin throws ApiError on a 401', async () => {
    server.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'bad' } }, { status: 401 }),
      ),
    );
    const { result } = renderHook(() => useLogin(), { wrapper });
    await expect(result.current.mutateAsync({ email: 'x@y.z', password: 'no' })).rejects.toBeInstanceOf(ApiError);
  });

  it('useConfig returns the config entries', async () => {
    const { result } = renderHook(() => useConfig(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.some((e) => e.key === 'scoring.distanceWeight')).toBe(true);
  });
});

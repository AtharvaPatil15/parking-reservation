import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { useMe, useUserDashboard } from './user';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('user hooks (against MSW)', () => {
  it('useMe returns the profile with distanceKm', async () => {
    const { result } = renderHook(() => useMe(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.distanceKm).toBe(8.5);
    expect(result.current.data?.role).toBe('USER');
  });

  it('useUserDashboard returns the cutoff countdown', async () => {
    const { result } = renderHook(() => useUserDashboard(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.cutoffCountdownSeconds).toBe(3600);
  });
});

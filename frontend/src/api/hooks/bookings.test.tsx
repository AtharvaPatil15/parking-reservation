import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { useBooking } from './bookings';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useBooking', () => {
  it('returns booking detail with a score breakdown', async () => {
    const { result } = renderHook(() => useBooking('bk-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe('ALLOCATED');
    expect(result.current.data?.scoreBreakdown?.finalScore).toBe(38.8);
  });

  it('is disabled without an id', () => {
    const { result } = renderHook(() => useBooking(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

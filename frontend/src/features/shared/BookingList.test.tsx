import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { BookingList } from './BookingList';

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<Wrap><BookingList scope="all" /></Wrap>);
}

describe('BookingList (admin roster)', () => {
  it('shows the allocation score for every booking — even non-allocated ones', async () => {
    renderList();
    // ab-3 (Lee Chen) is WAITLISTED with no slot but was scored 26.1 — the admin must see it.
    expect(await screen.findByText('Lee Chen')).toBeInTheDocument();
    expect(screen.getByText('WAITLISTED')).toBeInTheDocument();
    expect(screen.getByText('26.1')).toBeInTheDocument();
    // An allocated row shows its score too.
    expect(screen.getByText('47.2')).toBeInTheDocument();
  });
});

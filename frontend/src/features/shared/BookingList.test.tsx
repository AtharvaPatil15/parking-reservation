import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('shows release-promoted seats as released-slot allocations, not primary allocations', async () => {
    renderList();

    expect(await screen.findByText('D User')).toBeInTheDocument();
    expect(screen.getAllByText('RELEASED SLOT').length).toBeGreaterThan(0);
    expect(screen.getByText('RELEASED SLOT ALLOCATED')).toBeInTheDocument();
    expect(screen.getByText('COMMON POOL WAITLISTED')).toBeInTheDocument();
    expect(screen.queryByText('PRIMARY ALLOCATED')).not.toBeInTheDocument();
  });

  it('opens request details with people carried and passenger details', async () => {
    renderList();

    expect(await screen.findByText('Priya Rao')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /details/i })[0]);

    expect(screen.getByText('People carried')).toBeInTheDocument();
    expect(screen.getByText('Passengers')).toBeInTheDocument();
    expect(screen.getByText('Passenger 1')).toBeInTheDocument();
    expect(screen.getByText('passenger1@mock.test')).toBeInTheDocument();
    expect(screen.getByText('Contact: 9990000001')).toBeInTheDocument();
    expect(screen.getByText('Pickup: Pickup 1')).toBeInTheDocument();
  });
});

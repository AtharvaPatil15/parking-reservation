import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { Allocations } from './Allocations';

function renderAllocations() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<Wrap><Allocations /></Wrap>);
}

describe('CA Allocations roster', () => {
  it('lists allocated seats with employee, slot and type', async () => {
    renderAllocations();
    expect(await screen.findByText('Priya Rao')).toBeInTheDocument();
    expect(screen.getByText('A-12')).toBeInTheDocument();
    // "Primary" / "Common pool" appear both as filter options and as row badges.
    expect(screen.getAllByText('Primary').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Common pool').length).toBeGreaterThan(0);
  });

  it('filters to common-pool seats only', async () => {
    renderAllocations();
    await screen.findByText('Priya Rao'); // wait for first load
    await userEvent.selectOptions(screen.getByLabelText(/type/i), 'COMMON_POOL');
    expect(await screen.findByText('Lee Chen')).toBeInTheDocument();
    expect(screen.queryByText('Priya Rao')).not.toBeInTheDocument(); // primary row filtered out
  });
});

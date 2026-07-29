import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '../../mocks/node';
import { AllocationRun } from './AllocationRun';

function renderRun() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Wrap><AllocationRun /></Wrap>);
}

describe('AllocationRun', () => {
  it('renders the date field + run button', () => {
    renderRun();
    expect(screen.getByRole('button', { name: /run primary allocation/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/booking date/i)).toBeInTheDocument();
  });

  it('runs and shows the ranked breakdown', async () => {
    renderRun();
    await userEvent.click(screen.getByRole('button', { name: /run primary allocation/i }));
    expect(await screen.findByText('Priya Rao')).toBeInTheDocument();
    expect(screen.getByText('47.2')).toBeInTheDocument(); // rank-1 final score
    expect(screen.getByText('A-12')).toBeInTheDocument();
    expect(screen.getAllByText('ALLOCATED').length).toBeGreaterThan(0);
    expect(screen.getByText('WAITLISTED')).toBeInTheDocument();
  });

  it('shows an error when the run fails', async () => {
    server.use(
      http.post('*/api/v1/allocation/primary/run', () =>
        HttpResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'nope' } }, { status: 403 }),
      ),
    );
    renderRun();
    await userEvent.click(screen.getByRole('button', { name: /run primary allocation/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('shows an empty state when the breakdown has no results', async () => {
    server.use(
      http.get('*/api/v1/allocation/runs/:id/breakdown', () =>
        HttpResponse.json({
          success: true,
          data: {
            runId: 'run-demo',
            bookingDate: '2026-08-03',
            status: 'COMPLETED',
            weights: { distanceWeight: 0.6, carpoolWeight: 0.4 },
            results: [],
          },
        }),
      ),
    );
    renderRun();
    await userEvent.click(screen.getByRole('button', { name: /run primary allocation/i }));
    expect(await screen.findByText(/no results/i)).toBeInTheDocument();
  });

  it('shows an error state when the breakdown fails to load', async () => {
    server.use(
      http.get('*/api/v1/allocation/runs/:id/breakdown', () =>
        HttpResponse.json({ success: false, error: { code: 'INTERNAL', message: 'boom' } }, { status: 500 }),
      ),
    );
    renderRun();
    await userEvent.click(screen.getByRole('button', { name: /run primary allocation/i }));
    expect(await screen.findByText(/couldn.t load results/i)).toBeInTheDocument();
  });
});

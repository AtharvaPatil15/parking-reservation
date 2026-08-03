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

  it('starts the common pool and shows its ranked results', async () => {
    renderRun();
    await userEvent.click(screen.getByRole('button', { name: /start common pool/i }));
    expect(await screen.findByText('Priya Rao')).toBeInTheDocument();
    expect(screen.getAllByText('ALLOCATED').length).toBeGreaterThan(0);
  });

  it('locks re-running and shows stored results when primary allocation is already done', async () => {
    server.use(
      http.get('*/api/v1/allocation/runs', ({ request }) => {
        const type = new URL(request.url).searchParams.get('type');
        return HttpResponse.json({
          success: true,
          data:
            type === 'PRIMARY'
              ? {
                  id: 'run-demo', runType: 'PRIMARY', bookingDate: '2026-08-03', status: 'COMPLETED',
                  idempotencyKey: 'demo', attemptCount: 1, totalRequests: 3, allocatedCount: 2, waitlistedCount: 1,
                }
              : null, // common pool not run yet
        });
      }),
    );
    renderRun();
    // Stored breakdown loads without clicking anything.
    expect(await screen.findByText('Priya Rao')).toBeInTheDocument();
    expect(screen.getByText(/already been done for 2026-/i)).toBeInTheDocument();
    // The locked button relabels itself, so the disabled state is legible without reading the note.
    expect(screen.getByRole('button', { name: /primary allocation already done/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^run primary allocation$/i })).not.toBeInTheDocument();
    // Common pool wasn't run, so its button stays enabled and keeps its action label.
    expect(screen.getByRole('button', { name: /start common pool/i })).not.toBeDisabled();
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

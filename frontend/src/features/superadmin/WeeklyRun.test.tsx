import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '../../mocks/node';
import { ToastProvider } from '../../components';
import { WeeklyRun } from './WeeklyRun';

function renderWeekly() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  return render(<Wrap><WeeklyRun /></Wrap>);
}

/**
 * A band preview with both run statuses per date, so the two steps can be driven independently.
 * `waitlisted` is what the common pool would have to work with.
 */
function preview(
  rows: Array<{
    date: string;
    runStatus?: 'COMPLETED' | 'FAILED' | null;
    commonPoolStatus?: 'COMPLETED' | null;
    pending?: number;
    waitlisted?: number;
  }>,
) {
  return {
    success: true,
    data: {
      window: {
        nextRunAt: '2099-01-03T14:30:00.000Z',
        nextRunCountdownSeconds: 90_000,
        runDay: 'SUNDAY',
        runTime: '20:00',
        windowWeeks: 2,
        approvalLeadDays: 1,
        earliestDate: '2099-01-05',
        latestDate: '2099-01-09',
        requestableDates: rows.map((r) => r.date),
        scoring: { distanceWeight: 0.6, carpoolWeight: 0.4, maxDistanceKm: 40, maxPeople: 4 },
      },
      band: { from: rows[0].date, toExclusive: '2099-01-12', dates: rows.map((r) => r.date) },
      dates: rows.map((r) => ({
        bookingDate: r.date,
        runStatus: r.runStatus ?? null,
        pendingRequests: r.pending ?? 0,
        commonPoolStatus: r.commonPoolStatus ?? null,
        waitlistedRequests: r.waitlisted ?? 0,
      })),
    },
  };
}

const usePreview = (body: ReturnType<typeof preview>) =>
  server.use(http.get('*/api/v1/allocation/weekly', () => HttpResponse.json(body)));

describe('WeeklyRun — common pool over the band', () => {
  it('offers the common pool as a second step alongside the primary run', async () => {
    usePreview(preview([{ date: '2099-01-05', runStatus: 'COMPLETED', waitlisted: 3 }]));
    renderWeekly();

    expect(await screen.findByRole('button', { name: /run common pool for 1 date/i })).toBeEnabled();
    expect(screen.getByText(/3 waitlisted requests could be placed/i)).toBeInTheDocument();
  });

  /**
   * The gap this whole feature closes: a band could be fully decided while its waitlist sat untouched,
   * and the weekly screen said nothing about it. Primary "already decided" must NOT imply pool done.
   */
  it('still offers the pool when the band is decided but never pooled', async () => {
    usePreview(preview([{ date: '2099-01-05', runStatus: 'COMPLETED', commonPoolStatus: null, waitlisted: 2 }]));
    renderWeekly();

    expect(await screen.findByRole('button', { name: /band already decided/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /run common pool/i })).toBeEnabled();
  });

  it('reports each date\'s primary and common-pool status independently', async () => {
    usePreview(
      preview([
        { date: '2099-01-05', runStatus: 'COMPLETED', commonPoolStatus: 'COMPLETED', waitlisted: 0 },
        { date: '2099-01-06', runStatus: 'COMPLETED', commonPoolStatus: null, waitlisted: 4 },
      ]),
    );
    renderWeekly();

    await screen.findByText(/weekly allocation/i);
    const rows = screen.getAllByRole('row').slice(1); // drop the header
    // Row 1: both done. Row 2: primary done, pool not run — two "Decided" vs one + "Not run".
    expect(within(rows[0]).getAllByText('Decided')).toHaveLength(2);
    expect(within(rows[1]).getAllByText('Decided')).toHaveLength(1);
    expect(within(rows[1]).getByText('Not run')).toBeInTheDocument();
  });

  it('disables the pool when the band has nobody waitlisted', async () => {
    usePreview(preview([{ date: '2099-01-05', runStatus: 'COMPLETED', waitlisted: 0 }]));
    renderWeekly();

    expect(await screen.findByRole('button', { name: /run common pool/i })).toBeDisabled();
    expect(screen.getByText(/nobody to place/i)).toBeInTheDocument();
  });

  it('disables the pool once every date has been through it', async () => {
    usePreview(
      preview([{ date: '2099-01-05', runStatus: 'COMPLETED', commonPoolStatus: 'COMPLETED', waitlisted: 1 }]),
    );
    renderWeekly();

    expect(await screen.findByRole('button', { name: /common pool already run/i })).toBeDisabled();
    expect(screen.getByText(/been through the pool/i)).toBeInTheDocument();
  });

  it('runs the pool over the band and reports per-date placements', async () => {
    usePreview(
      preview([
        { date: '2099-01-05', runStatus: 'COMPLETED', waitlisted: 2 },
        { date: '2099-01-06', runStatus: 'COMPLETED', waitlisted: 1 },
      ]),
    );
    server.use(
      http.post('*/api/v1/allocation/weekly/common-pool/run', () =>
        HttpResponse.json({
          success: true,
          data: {
            runAt: '2099-01-03T14:31:00.000Z',
            band: { from: '2099-01-05', toExclusive: '2099-01-12', dates: ['2099-01-05', '2099-01-06'] },
            dates: [
              { bookingDate: '2099-01-05', runId: 'cp-1', status: 'COMPLETED', alreadyDecided: false, allocated: 2, waitlisted: 0, error: null },
              { bookingDate: '2099-01-06', runId: 'cp-2', status: 'COMPLETED', alreadyDecided: false, allocated: 0, waitlisted: 1, error: null },
            ],
            totalAllocated: 2,
            totalWaitlisted: 1,
          },
        }),
      ),
    );
    renderWeekly();

    await userEvent.click(await screen.findByRole('button', { name: /run common pool/i }));

    const panel = await screen.findByText(/last common-pool run/i);
    expect(panel).toBeInTheDocument();
    expect(screen.getByText(/2 placed from the pool · 1 still waitlisted/i)).toBeInTheDocument();
    expect(screen.getByText(/2 placed, 0 still waitlisted/i)).toBeInTheDocument();
    expect(screen.getByText(/0 placed, 1 still waitlisted/i)).toBeInTheDocument();
  });

  it('says so plainly when the pool ran but had no spare slots', async () => {
    usePreview(preview([{ date: '2099-01-05', runStatus: 'COMPLETED', waitlisted: 5 }]));
    server.use(
      http.post('*/api/v1/allocation/weekly/common-pool/run', () =>
        HttpResponse.json({
          success: true,
          data: {
            runAt: '2099-01-03T14:31:00.000Z',
            band: { from: '2099-01-05', toExclusive: '2099-01-12', dates: ['2099-01-05'] },
            dates: [
              { bookingDate: '2099-01-05', runId: 'cp-1', status: 'COMPLETED', alreadyDecided: false, allocated: 0, waitlisted: 5, error: null },
            ],
            totalAllocated: 0,
            totalWaitlisted: 5,
          },
        }),
      ),
    );
    renderWeekly();

    await userEvent.click(await screen.findByRole('button', { name: /run common pool/i }));
    // Not phrased as a success — nothing moved, and saying "placed 0" as a win would mislead.
    await waitFor(() => expect(screen.getByText(/no spare slots to redistribute/i)).toBeInTheDocument());
  });

  it('surfaces a failed pool run without claiming it worked', async () => {
    usePreview(preview([{ date: '2099-01-05', runStatus: 'COMPLETED', waitlisted: 2 }]));
    server.use(
      http.post('*/api/v1/allocation/weekly/common-pool/run', () =>
        HttpResponse.json(
          { success: false, error: { code: 'INTERNAL', message: 'Pool derivation failed' } },
          { status: 500 },
        ),
      ),
    );
    renderWeekly();

    await userEvent.click(await screen.findByRole('button', { name: /run common pool/i }));
    await waitFor(() => expect(screen.getByText(/pool derivation failed/i)).toBeInTheDocument());
    expect(screen.queryByText(/last common-pool run/i)).not.toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '../../mocks/node';
import { MOCK_UPCOMING_DATE } from '../../mocks/handlers';
import { UserDashboard } from './UserDashboard';

function renderDash() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route path="/app" element={children} />
          <Route path="/app/book" element={<div>Book page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Wrap><UserDashboard /></Wrap>);
}

/** One fixed `Your week` payload covering all four row states (P8-13). */
function weekAvailability() {
  const day = (
    date: string,
    opts: {
      phase?: 'OPEN' | 'DECIDED';
      requestCount?: number;
      blocked?: number;
      allocatedCount?: number;
      myStatus?: 'SUBMITTED' | 'ALLOCATED' | 'WAITLISTED' | 'RELEASED' | null;
      mySlotNumber?: string | null;
      quota?: number;
    } = {},
  ) => {
    const quota = opts.quota ?? 12;
    const phase = opts.phase ?? 'OPEN';
    const blocked = opts.blocked ?? 0;
    return {
      date,
      phase,
      quota,
      blocked,
      requestCount: opts.requestCount ?? 0,
      allocatedCount: opts.allocatedCount ?? 0,
      available: quota - blocked,
      mine: opts.myStatus != null,
      myStatus: opts.myStatus ?? null,
      mySlotNumber: opts.mySlotNumber ?? null,
      requestable: opts.myStatus == null && phase === 'OPEN',
      reason: opts.myStatus != null ? 'ALREADY_BOOKED' : phase === 'DECIDED' ? 'TOO_SOON' : null,
      message: null,
      boxes:
        phase === 'OPEN'
          ? Array.from({ length: quota }, (_, i) => ({
              index: i + 1,
              state: i < blocked ? 'BLOCKED' : 'AVAILABLE',
              slotNumber: null,
            }))
          : Array.from({ length: quota }, (_, i) => ({
              index: i + 1,
              state: opts.myStatus === 'ALLOCATED' && i === 0 ? 'MINE' : i < blocked ? 'BLOCKED' : 'AVAILABLE',
              slotNumber: opts.myStatus === 'ALLOCATED' && i === 0 ? opts.mySlotNumber ?? null : null,
            })),
    };
  };
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
        requestableDates: ['2099-01-05', '2099-01-06'],
        scoring: { distanceWeight: 0.6, carpoolWeight: 0.4, maxDistanceKm: 40, maxPeople: 4 },
      },
      days: [
        day('2099-01-05', { myStatus: 'SUBMITTED', requestCount: 3 }),
        day('2099-01-06', { phase: 'DECIDED', myStatus: 'ALLOCATED', mySlotNumber: 'A-07', allocatedCount: 1 }),
        day('2099-01-07', { phase: 'DECIDED', myStatus: 'WAITLISTED', allocatedCount: 12 }),
        day('2099-01-08', { blocked: 12, quota: 12 }),
      ],
    },
  };
}

describe('UserDashboard', () => {
  it('shows the upcoming booking + a book CTA', async () => {
    renderDash();
    expect(await screen.findByText(new RegExp(MOCK_UPCOMING_DATE))).toBeInTheDocument();
    expect(screen.getByText('ALLOCATED')).toBeInTheDocument();
    expect(screen.getByText(/next allocation run/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /book a slot/i })).toBeInTheDocument();
  });

  it('shows an empty state when there is no upcoming booking', async () => {
    server.use(
      http.get('*/api/v1/dashboard/user', () =>
        HttpResponse.json({ success: true, data: { cutoffCountdownSeconds: null, previousBookingsCount: 0 } }),
      ),
    );
    renderDash();
    expect(await screen.findByText(/no upcoming booking/i)).toBeInTheDocument();
  });

  /**
   * No mocked test can catch this by rendering: the mocks build DECIDED dates inside the requestable
   * window, which the real server never does. With no `from`, the server starts at the earliest
   * *requestable* date (next run + lead days) — in the future — so the dates the last run decided fall
   * out of the payload and every ALLOCATED / WAITLISTED row disappears the day after a run. Assert the
   * range bound directly.
   */
  it('asks for availability from today, so dates the last run decided are still in range', async () => {
    let requestedFrom: string | null = null;
    server.use(
      http.get('*/api/v1/availability', ({ request }) => {
        requestedFrom = new URL(request.url).searchParams.get('from');
        return HttpResponse.json(weekAvailability());
      }),
    );
    renderDash();

    await screen.findByText(/your week/i);
    expect(requestedFrom).not.toBeNull();
    // `en-CA` in IST is the same yyyy-mm-dd the component sends.
    const todayIst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    expect(requestedFrom! <= todayIst).toBe(true);
  });

  it('renders a "Your week" panel with all four row states from a single availability call', async () => {
    server.use(http.get('*/api/v1/availability', () => HttpResponse.json(weekAvailability())));
    renderDash();

    expect(await screen.findByText(/your week/i)).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.getByText(/you got slot a-07/i)).toBeInTheDocument();
    expect(screen.getByText('Waitlisted')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
  });
});

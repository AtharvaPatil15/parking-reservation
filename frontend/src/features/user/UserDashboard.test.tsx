import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('UserDashboard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the upcoming booking + a book CTA', async () => {
    renderDash();
    expect(await screen.findByText(new RegExp(MOCK_UPCOMING_DATE))).toBeInTheDocument();
    expect(screen.getByText('ALLOCATED')).toBeInTheDocument();
    expect(screen.getByText(/next allocation run/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /book a slot/i })).toBeInTheDocument();
  });

  it('ticks the next-allocation-run countdown down in real time', async () => {
    // Fake timers must be installed before mount so they own the hook's interval.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.use(
      http.get('*/api/v1/dashboard/user', () =>
        HttpResponse.json({
          success: true,
          data: {
            cutoffCountdownSeconds: null,
            previousBookingsCount: 0,
            nextAllocationRunAt: '2026-08-10T10:00:00.000Z',
            nextAllocationRunCountdownSeconds: 120,
          },
        }),
      ),
    );
    renderDash();

    expect(await screen.findByText(/runs in 2m 00s/i)).toBeInTheDocument();

    // The payload value must not be rendered frozen — the display re-reads a ticking clock.
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText(/runs in 1m 57s/i)).toBeInTheDocument();
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
});

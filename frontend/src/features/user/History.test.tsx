import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '../../mocks/node';
import { History } from './History';

function renderHistory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/my-bookings']}>
        <Routes>
          <Route path="/my-bookings" element={children} />
          <Route path="/booking/:id" element={<div>Detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Wrap><History /></Wrap>);
}

describe('History', () => {
  it('lists the user bookings', async () => {
    renderHistory();
    expect(await screen.findByText('2026-08-03')).toBeInTheDocument();
    // Past-dated rows are resolved states, never WAITLISTED (KI-2).
    expect(screen.getByText('ALLOCATED')).toBeInTheDocument();
    expect(screen.getByText('REJECTED')).toBeInTheDocument();
  });

  it('paginates', async () => {
    server.use(
      http.get('*/api/v1/me/bookings', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page') ?? '1');
        const row = { id: `id-${page}`, bookingDate: page === 1 ? '2030-01-01' : '2030-02-02', bookingType: 'PRIMARY', status: 'ALLOCATED', carpoolMemberCount: 1, createdAt: '2026-07-29T08:00:00.000Z' };
        return HttpResponse.json({ success: true, data: [row], meta: { page, pageSize: 1, total: 2 } });
      }),
    );
    renderHistory();
    expect(await screen.findByText('2030-01-01')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(screen.getByText('2030-02-02')).toBeInTheDocument());
  });
});

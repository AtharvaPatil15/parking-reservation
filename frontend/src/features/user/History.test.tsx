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
      <MemoryRouter initialEntries={['/app/history']}>
        <Routes>
          <Route path="/app/history" element={children} />
          <Route path="/app/booking/:id" element={<div>Detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Wrap><History /></Wrap>);
}

describe('History', () => {
  it('lists the user bookings', async () => {
    renderHistory();
    expect(await screen.findByText('bk-1')).toBeInTheDocument();
    expect(screen.getByText('WAITLISTED')).toBeInTheDocument();
  });

  it('paginates', async () => {
    server.use(
      http.get('*/api/v1/me/bookings', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page') ?? '1');
        const row = { id: `p${page}`, bookingDate: '2026-08-03', bookingType: 'PRIMARY', status: 'ALLOCATED', carpoolMemberCount: 1, createdAt: '2026-07-29T08:00:00.000Z' };
        return HttpResponse.json({ success: true, data: [row], meta: { page, pageSize: 1, total: 2 } });
      }),
    );
    renderHistory();
    expect(await screen.findByText('p1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(screen.getByText('p2')).toBeInTheDocument());
  });
});

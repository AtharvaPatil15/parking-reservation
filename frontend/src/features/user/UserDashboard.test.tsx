import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '../../mocks/node';
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
  it('shows the upcoming booking + a book CTA', async () => {
    renderDash();
    expect(await screen.findByText(/2026-08-03/)).toBeInTheDocument();
    expect(screen.getByText('ALLOCATED')).toBeInTheDocument();
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
});

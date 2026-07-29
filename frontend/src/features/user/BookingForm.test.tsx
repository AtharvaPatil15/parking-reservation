import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '../../mocks/node';
import { BookingForm } from './BookingForm';

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/book']}>
        <Routes>
          <Route path="/app/book" element={children} />
          <Route path="/app/booking/:id" element={<div>Status page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Wrap><BookingForm /></Wrap>);
}

describe('BookingForm', () => {
  it('renders fields and the distance from the profile', async () => {
    renderForm();
    expect(await screen.findByRole('heading', { name: /book a parking slot/i })).toBeInTheDocument();
    expect(screen.getByText(/8\.5 km/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^date$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/carpool people/i)).toBeInTheDocument();
  });

  it('rejects a weekend date', async () => {
    renderForm();
    const date = await screen.findByLabelText(/^date$/i);
    await userEvent.clear(date);
    await userEvent.type(date, '2026-08-01'); // Saturday
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }));
    expect(await screen.findByText(/weekday/i)).toBeInTheDocument();
    expect(screen.queryByText('Status page')).not.toBeInTheDocument();
  });

  it('submits a valid booking and shows success', async () => {
    renderForm();
    const date = await screen.findByLabelText(/^date$/i);
    await userEvent.clear(date);
    await userEvent.type(date, '2099-01-05'); // Monday, far future
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }));
    expect(await screen.findByText(/request submitted/i)).toBeInTheDocument();
  });

  it('maps a 409 to a duplicate-request message', async () => {
    server.use(
      http.post('*/api/v1/bookings', () =>
        HttpResponse.json({ success: false, error: { code: 'CONFLICT', message: 'dup' } }, { status: 409 }),
      ),
    );
    renderForm();
    const date = await screen.findByLabelText(/^date$/i);
    await userEvent.clear(date);
    await userEvent.type(date, '2099-01-05');
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already have a request/i);
  });

  it('disables submit when the cutoff has passed', async () => {
    server.use(
      http.get('*/api/v1/dashboard/user', () =>
        HttpResponse.json({ success: true, data: { cutoffCountdownSeconds: 0, previousBookingsCount: 0 } }),
      ),
    );
    renderForm();
    await waitFor(() => expect(screen.getByRole('button', { name: /submit request/i })).toBeDisabled());
    expect(screen.getByText(/window closed/i)).toBeInTheDocument();
  });
});

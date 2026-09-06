import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '../../mocks/node';
import { ToastProvider } from '../../components';
import { BookingStatus } from './BookingStatus';

function renderAt(id = 'bk-1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/booking/${id}`]}>
          <Routes>
            <Route path="/booking/:id" element={children} />
            <Route path="/app" element={<div>User area</div>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  return render(<Wrap><BookingStatus /></Wrap>);
}

describe('BookingStatus', () => {
  it('shows status, slot, and the score breakdown', async () => {
    renderAt();
    expect(await screen.findByText('A-12')).toBeInTheDocument();
    expect(screen.getByText('ALLOCATED')).toBeInTheDocument();
    expect(screen.getByText('38.8')).toBeInTheDocument(); // final score
  });

  it('releases an allocated slot', async () => {
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: /release slot/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^release$/i }));
    expect(await screen.findByText(/slot released/i)).toBeInTheDocument(); // toast
  });

  it('hides release for a past-dated allocation (KI-1)', async () => {
    server.use(
      http.get('*/api/v1/bookings/:id', ({ params }) =>
        HttpResponse.json({ success: true, data: {
          id: String(params.id), bookingDate: '2020-01-06', bookingType: 'PRIMARY',
          status: 'ALLOCATED', allocatedSlotNumber: 'A-99', carpoolMemberCount: 1,
          createdAt: '2020-01-01T08:00:00.000Z',
        } }),
      ),
    );
    renderAt();
    expect(await screen.findByText('A-99')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /release slot/i })).not.toBeInTheDocument();
  });

  it('shows an error state on 404', async () => {
    server.use(
      http.get('*/api/v1/bookings/:id', () =>
        HttpResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'gone' } }, { status: 404 }),
      ),
    );
    renderAt('missing');
    expect(await screen.findByText(/couldn.t load booking/i)).toBeInTheDocument();
  });

  it('lets you add a carpool member in the edit flow', async () => {
    server.use(
      http.get('*/api/v1/bookings/:id', ({ params }) =>
        HttpResponse.json({ success: true, data: {
          id: String(params.id), bookingDate: '2099-01-05', bookingType: 'PRIMARY',
          status: 'SUBMITTED', carpoolMemberCount: 0, carpoolMembers: [],
          createdAt: '2026-07-29T08:00:00.000Z',
        } }),
      ),
    );
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: /edit booking/i }));
    const people = screen.getByLabelText(/people \(incl/i);
    await userEvent.clear(people);
    await userEvent.type(people, '2');
    await userEvent.click(screen.getByRole('button', { name: /add member/i }));
    await userEvent.type(screen.getByLabelText(/member 1 name/i), 'Sam');
    await userEvent.type(screen.getByLabelText(/member 1 username/i), 'sam');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/booking updated/i)).toBeInTheDocument();
  });

  it('notes when not scored yet', async () => {
    server.use(
      http.get('*/api/v1/bookings/:id', ({ params }) =>
        HttpResponse.json({ success: true, data: {
          id: String(params.id), bookingDate: '2026-08-03', bookingType: 'PRIMARY',
          status: 'SUBMITTED', carpoolMemberCount: 1, createdAt: '2026-07-29T08:00:00.000Z',
        } }),
      ),
    );
    renderAt();
    expect(await screen.findByText(/not scored yet/i)).toBeInTheDocument();
  });
});

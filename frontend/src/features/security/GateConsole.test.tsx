import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '../../mocks/node';
import { ToastProvider } from '../../components';
import { AuthProvider } from '../../lib/auth';
import { GateConsole } from './GateConsole';

/**
 * Phase 7 security console. The behaviour that matters most is D16: the gate must never be blocked —
 * an unknown car, or a known one with no booking, still records an entry (with a warning).
 */

function renderConsole() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={['/security']}>{children}</MemoryRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
  return render(<Wrap><GateConsole /></Wrap>);
}

const lookup = (data: Record<string, unknown>) =>
  server.use(http.get('*/api/v1/vehicles/lookup', () => HttpResponse.json({ success: true, data })));

const KNOWN_VEHICLE = {
  id: 'veh-1',
  vehicleNumber: 'MH12AB1234',
  displayNumber: 'MH 12 AB 1234',
  ownerName: 'Aditi Rao',
  ownerEmail: 'aditi@assent.example',
  contactNumber: '9822001101',
  vehicleType: 'CAR',
  makeModel: 'Hyundai i20',
  colour: 'White',
  companyId: 'mock-co',
  companyName: 'Mock Co',
};

describe('GateConsole', () => {
  it('offers exactly two actions', async () => {
    renderConsole();
    expect(await screen.findByRole('button', { name: /^check in$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^check out$/i })).toBeInTheDocument();
  });

  it('fills in the driver from the car number and shows the allocated slot', async () => {
    lookup({
      vehicleNumber: 'MH12AB1234',
      known: true,
      vehicle: KNOWN_VEHICLE,
      bookingDate: '2026-08-03',
      hasBooking: true,
      booking: { id: 'bk-1', status: 'ALLOCATED', bookingType: 'PRIMARY', allocatedSlotNumber: 'B1-03' },
      openVisit: null,
    });
    renderConsole();
    await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
    await userEvent.type(screen.getByLabelText(/car number/i), 'MH12AB1234');

    // The guard never types a name — it is resolved from the registry.
    expect(await screen.findByText('Aditi Rao')).toBeInTheDocument();
    expect(screen.getByText('Booked today')).toBeInTheDocument();
    expect(screen.getByText('B1-03')).toBeInTheDocument();
  });

  it('normalizes sloppy spacing before looking the car up', async () => {
    let asked = '';
    server.use(
      http.get('*/api/v1/vehicles/lookup', ({ request }) => {
        asked = new URL(request.url).searchParams.get('number') ?? '';
        return HttpResponse.json({
          success: true,
          data: {
            vehicleNumber: 'MH12AB1234', known: true, vehicle: KNOWN_VEHICLE,
            bookingDate: '2026-08-03', hasBooking: true,
            booking: { id: 'bk-1', status: 'ALLOCATED', bookingType: 'PRIMARY', allocatedSlotNumber: null },
            openVisit: null,
          },
        });
      }),
    );
    renderConsole();
    await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
    await userEvent.type(screen.getByLabelText(/car number/i), 'mh-12 ab.1234');
    // The raw string goes to the server, which normalizes it; the resolved plate comes back canonical.
    await waitFor(() => expect(asked).toBe('mh-12 ab.1234'));
    expect(await screen.findByText('Aditi Rao')).toBeInTheDocument();
  });

  it('warns but still allows a check-in with no booking (D16)', async () => {
    lookup({
      vehicleNumber: 'MH12CD5678',
      known: true,
      vehicle: { ...KNOWN_VEHICLE, id: 'veh-2', vehicleNumber: 'MH12CD5678', displayNumber: 'MH 12 CD 5678', ownerName: 'Rahul Mehta' },
      bookingDate: '2026-08-03',
      hasBooking: false,
      booking: null,
      openVisit: null,
    });
    renderConsole();
    await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
    await userEvent.type(screen.getByLabelText(/car number/i), 'MH12CD5678');

    expect(await screen.findByText('No booking today')).toBeInTheDocument();
    expect(screen.getByText(/you can still let them in/i)).toBeInTheDocument();
    // Crucially, the confirm button stays enabled — the barrier is never blocked.
    expect(screen.getByRole('button', { name: /confirm check in/i })).toBeEnabled();
  });

  it('records an unregistered plate rather than refusing it', async () => {
    lookup({
      vehicleNumber: 'KA05ZZ9999',
      known: false,
      vehicle: null,
      bookingDate: '2026-08-03',
      hasBooking: false,
      booking: null,
      openVisit: null,
    });
    renderConsole();
    await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
    await userEvent.type(screen.getByLabelText(/car number/i), 'KA05ZZ9999');

    expect(await screen.findByText(/not in the vehicle registry/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm check in/i })).toBeEnabled();
  });

  it('flags a car that is already inside', async () => {
    lookup({
      vehicleNumber: 'MH12AB1234',
      known: true,
      vehicle: KNOWN_VEHICLE,
      bookingDate: '2026-08-03',
      hasBooking: true,
      booking: { id: 'bk-1', status: 'ALLOCATED', bookingType: 'PRIMARY', allocatedSlotNumber: 'B1-03' },
      openVisit: { id: 'gate-1', checkInAt: '2026-08-03T03:30:00.000Z' },
    });
    renderConsole();
    await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
    await userEvent.type(screen.getByLabelText(/car number/i), 'MH12AB1234');
    expect(await screen.findByText(/already checked in/i)).toBeInTheDocument();
  });

  it('keeps the confirm button disabled until the number is long enough', async () => {
    renderConsole();
    await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
    expect(screen.getByRole('button', { name: /confirm check in/i })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/car number/i), 'MH12');
    expect(screen.getByRole('button', { name: /confirm check in/i })).toBeEnabled();
  });

  it('submits a check-in and closes the drawer', async () => {
    lookup({
      vehicleNumber: 'MH12AB1234', known: true, vehicle: KNOWN_VEHICLE,
      bookingDate: '2026-08-03', hasBooking: true,
      booking: { id: 'bk-1', status: 'ALLOCATED', bookingType: 'PRIMARY', allocatedSlotNumber: 'B1-03' },
      openVisit: null,
    });
    renderConsole();
    await userEvent.click(await screen.findByRole('button', { name: /^check in$/i }));
    await userEvent.type(screen.getByLabelText(/car number/i), 'MH12AB1234');
    await userEvent.click(screen.getByRole('button', { name: /confirm check in/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('surfaces a check-out refusal for a car that is not inside', async () => {
    lookup({
      vehicleNumber: 'MH12AB1234', known: true, vehicle: KNOWN_VEHICLE,
      bookingDate: '2026-08-03', hasBooking: false, booking: null, openVisit: null,
    });
    server.use(
      http.post('*/api/v1/gate/check-out', () =>
        HttpResponse.json(
          { success: false, error: { code: 'NOT_FOUND', message: 'MH12AB1234 is not currently checked in' } },
          { status: 404 },
        ),
      ),
    );
    renderConsole();
    await userEvent.click(await screen.findByRole('button', { name: /^check out$/i }));
    await userEvent.type(screen.getByLabelText(/car number/i), 'MH12AB1234');
    await userEvent.click(screen.getByRole('button', { name: /confirm check out/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not currently checked in/i);
  });

  it('lists today’s visits', async () => {
    server.use(
      http.get('*/api/v1/gate/events', () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              id: 'gate-1', vehicleNumber: 'MH12AB1234', displayNumber: 'MH 12 AB 1234',
              ownerName: 'Aditi Rao', companyId: 'mock-co', companyName: 'Mock Co',
              bookingDate: '2026-08-03', bookingRequestId: 'bk-1', hadBooking: true,
              status: 'CHECKED_IN', checkInAt: '2026-08-03T03:30:00.000Z', checkOutAt: null, notes: null,
            },
            {
              id: 'gate-2', vehicleNumber: 'KA05ZZ9999', displayNumber: 'KA05ZZ9999',
              ownerName: null, companyId: null, companyName: null,
              bookingDate: '2026-08-03', bookingRequestId: null, hadBooking: false,
              status: 'CHECKED_OUT', checkInAt: '2026-08-03T04:00:00.000Z',
              checkOutAt: '2026-08-03T06:00:00.000Z', notes: null,
            },
          ],
          meta: { page: 1, pageSize: 20, total: 2 },
        }),
      ),
    );
    renderConsole();
    expect(await screen.findByText('MH 12 AB 1234')).toBeInTheDocument();
    expect(screen.getByText('Unregistered vehicle')).toBeInTheDocument();
    expect(screen.getByText(/1 inside/)).toBeInTheDocument();
    expect(screen.getByText(/1 without a booking/)).toBeInTheDocument();
  });
});

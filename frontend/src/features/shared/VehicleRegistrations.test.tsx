import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '../../mocks/node';
import { ToastProvider } from '../../components';
import { VehicleRegistrations } from './VehicleRegistrations';

/**
 * The approval queue for cars security registered at the barrier. Shared by the company-admin and
 * super-admin screens, so it is tested once here rather than twice through them.
 *
 * What makes this queue different from every other approval in the app: somebody is standing outside
 * while it waits, and approving is what actually lets them in.
 */
function renderQueue(props: { showCompany?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return render(<Wrap><VehicleRegistrations {...props} /></Wrap>);
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'vreg-1',
  vehicleNumber: 'MH14XY9911',
  displayNumber: 'MH 14 XY 9911',
  ownerName: 'Nikhil Rao',
  ownerEmail: null,
  contactNumber: '9876500011',
  companyId: 'c1',
  companyName: 'Assent',
  vehicleType: 'CAR',
  makeModel: 'Maruti Baleno',
  colour: 'Grey',
  notes: null,
  status: 'PENDING',
  requestedById: 'sec-1',
  decidedById: null,
  decidedAt: null,
  decisionNote: null,
  vehicleId: null,
  createdAt: '2026-08-05T05:00:00.000Z',
  ...over,
});

const useRows = (rows: Array<Record<string, unknown>>) =>
  server.use(
    http.get('*/api/v1/vehicles/registrations', () =>
      HttpResponse.json({ success: true, data: rows, meta: { page: 1, pageSize: 10, total: rows.length } }),
    ),
  );

describe('VehicleRegistrations', () => {
  it('shows the waiting count and the person behind the plate', async () => {
    useRows([row()]);
    renderQueue();

    expect(await screen.findByText(/cars at the gate \(1 waiting\)/i)).toBeInTheDocument();
    expect(screen.getByText('MH 14 XY 9911')).toBeInTheDocument();
    expect(screen.getByText('Nikhil Rao')).toBeInTheDocument();
    // The contact is the point: the admin may well have to ring the person before deciding.
    expect(screen.getByText('9876500011')).toBeInTheDocument();
  });

  it('approves a request and says the car can now be let in', async () => {
    useRows([row()]);
    server.use(
      http.post('*/api/v1/vehicles/registrations/:id/decision', () =>
        HttpResponse.json({ success: true, data: row({ status: 'APPROVED' }) }),
      ),
    );
    renderQueue();

    await userEvent.click(await screen.findByRole('button', { name: /approve/i }));
    // Phrased in terms of the consequence, not the record: the admin's next thought is the guard's call.
    expect(await screen.findByText(/security can let them in/i)).toBeInTheDocument();
  });

  it('surfaces a rejected decision without claiming it worked', async () => {
    useRows([row()]);
    server.use(
      http.post('*/api/v1/vehicles/registrations/:id/decision', () =>
        HttpResponse.json(
          { success: false, error: { code: 'VALIDATION_ERROR', message: 'This request was already approved' } },
          { status: 400 },
        ),
      ),
    );
    renderQueue();

    await userEvent.click(await screen.findByRole('button', { name: /approve/i }));
    expect(await screen.findByText(/already approved/i)).toBeInTheDocument();
  });

  it('offers no buttons on a request that has already been decided', async () => {
    useRows([row({ status: 'APPROVED', decidedAt: '2026-08-05T06:00:00.000Z' })]);
    renderQueue();

    const tableRow = (await screen.findByText('MH 14 XY 9911')).closest('tr')!;
    expect(within(tableRow).queryByRole('button')).not.toBeInTheDocument();
    expect(within(tableRow).getByText('APPROVED')).toBeInTheDocument();
  });

  it('names the company only for the super admin, who sees every tenant', async () => {
    useRows([row()]);
    const { unmount } = renderQueue();
    // Without it, a Super Admin cannot tell whose employee they are approving.
    expect(await screen.findByText('MH 14 XY 9911')).toBeInTheDocument();
    expect(screen.queryByText('Assent')).not.toBeInTheDocument();
    unmount();

    useRows([row()]);
    renderQueue({ showCompany: true });
    expect(await screen.findByText('Assent')).toBeInTheDocument();
  });

  it('says plainly when there is nothing waiting', async () => {
    useRows([]);
    renderQueue();
    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '../../mocks/node';
import { UserDetailsModal } from './UserDetailsModal';

/**
 * The details dialog both approval screens open.
 *
 * It exists because the queue rows carry name/email/status, which is not enough to approve on. The field
 * that matters most is the home→office distance: it is 60% of the allocation score, so it decides who
 * wins a contested day for as long as the account exists.
 */
function renderModal(userId: string | null = 'u1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <Wrap>
      <UserDetailsModal userId={userId} onClose={() => {}} />
    </Wrap>,
  );
}

const detail = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  fullName: 'Nadia Khan',
  email: 'nadia@assent.example',
  contactNumber: '9822001199',
  address: '14 Baner Road, Pune',
  pinCode: '411045',
  distanceKm: 18.6,
  status: 'PENDING',
  emailVerified: false,
  companyId: 'c1',
  companyName: 'Assent',
  role: 'USER',
  createdAt: '2026-08-01T05:00:00.000Z',
  updatedAt: '2026-08-01T05:00:00.000Z',
  vehicles: [
    {
      id: 'v1',
      vehicleNumber: 'MH12AB1234',
      displayNumber: 'MH 12 AB 1234',
      vehicleType: 'CAR',
      makeModel: 'Hyundai i20',
      colour: 'White',
    },
  ],
  ...over,
});

const useDetail = (data: Record<string, unknown>) =>
  server.use(http.get('*/api/v1/users/:id', () => HttpResponse.json({ success: true, data })));

describe('UserDetailsModal', () => {
  it('shows the distance, the address behind it, and their cars', async () => {
    useDetail(detail());
    renderModal();

    expect(await screen.findByText('18.6 km')).toBeInTheDocument();
    // The address is the only way an admin can sanity-check a self-reported distance.
    expect(screen.getByText('14 Baner Road, Pune')).toBeInTheDocument();
    expect(screen.getByText('411045')).toBeInTheDocument();
    expect(screen.getByText('MH 12 AB 1234')).toBeInTheDocument();
    expect(screen.getByText(/60% of the allocation score/i)).toBeInTheDocument();
  });

  it('warns when no distance is set, because they cannot book at all', async () => {
    useDetail(detail({ distanceKm: null }));
    renderModal();

    expect(await screen.findByText(/cannot book until they add it/i)).toBeInTheDocument();
    // The "why it matters" footnote is pointless when there is no number to explain.
    expect(screen.queryByText(/60% of the allocation score/i)).not.toBeInTheDocument();
  });

  it('says so when there are no cars, rather than showing an empty list', async () => {
    useDetail(detail({ vehicles: [] }));
    renderModal();
    expect(await screen.findByText(/no cars in the registry yet/i)).toBeInTheDocument();
  });

  it('fetches nothing until it is opened', async () => {
    let asked = 0;
    server.use(
      http.get('*/api/v1/users/:id', () => {
        asked += 1;
        return HttpResponse.json({ success: true, data: detail() });
      }),
    );
    // The queues are paged and most rows are never inspected — joining this into the list would be waste.
    renderModal(null);
    expect(asked).toBe(0);
    expect(screen.queryByText('Nadia Khan')).not.toBeInTheDocument();
  });
});

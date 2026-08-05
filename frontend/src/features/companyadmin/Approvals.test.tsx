import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ToastProvider } from '../../components';
import { AuthProvider, type AuthUser } from '../../lib/auth';
import { Approvals } from './Approvals';

const companyAdmin: AuthUser = {
  id: 'ca1', fullName: 'Cara Company', role: 'COMPANY_ADMIN', companyId: 'mock-co', companyName: 'Mock Co',
};

function renderApprovals() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <AuthProvider initialSession={{ accessToken: 't', user: companyAdmin }}>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
  return render(<Wrap><Approvals /></Wrap>);
}

describe('Approvals', () => {
  it('lists members with statuses', async () => {
    renderApprovals();
    expect(await screen.findByText('Priya Rao')).toBeInTheDocument();
    expect(screen.getByText('Nadia Khan')).toBeInTheDocument();
    expect(screen.getAllByText('PENDING').length).toBeGreaterThan(0);
  });

  it('approves a pending member', async () => {
    renderApprovals();
    // Scoped to the member's own row: the screen now carries a second approval queue (walk-in cars from
    // the gate), so an unscoped /approve/i matches whichever button happens to render first.
    const row = (await screen.findByText('Nadia Khan')).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /approve/i }));
    expect(await screen.findByText(/user approved/i)).toBeInTheDocument();
  });

  it('removes a member with the X action', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderApprovals();
    expect(await screen.findByText('Priya Rao')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /remove priya rao/i }));
    expect(await screen.findByText(/user removed/i)).toBeInTheDocument();
  });
});

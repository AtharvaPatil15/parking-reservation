import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
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
    await screen.findByText('Nadia Khan');
    await userEvent.click(screen.getAllByRole('button', { name: /approve/i })[0]);
    expect(await screen.findByText(/user approved/i)).toBeInTheDocument();
  });
});

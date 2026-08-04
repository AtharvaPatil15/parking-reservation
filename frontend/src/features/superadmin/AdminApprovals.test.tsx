import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ToastProvider } from '../../components';
import { AdminApprovals } from './AdminApprovals';

function renderAdminApprovals() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return render(<Wrap><AdminApprovals /></Wrap>);
}

describe('AdminApprovals', () => {
  it('lists pending company-admin requests with their company', async () => {
    renderAdminApprovals();
    expect(await screen.findByText('Blair Ng')).toBeInTheDocument();
    expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(0);
  });

  it('approves a pending company-admin request', async () => {
    renderAdminApprovals();
    await screen.findByText('Blair Ng');
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(await screen.findByText(/company admin approved/i)).toBeInTheDocument();
  });

  it('records processed requests in the approval history', async () => {
    renderAdminApprovals();
    await screen.findByText('Blair Ng');
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    // The decided request moves to the persisted "Approval history" (server-backed).
    expect((await screen.findAllByText('Approved')).length).toBeGreaterThan(0);
  });

  it('removes a privileged user from the history', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAdminApprovals();
    expect(await screen.findByText('Gate Guard')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /remove gate guard/i }));
    expect(await screen.findByText(/user removed/i)).toBeInTheDocument();
  });
});

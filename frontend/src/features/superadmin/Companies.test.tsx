import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { ToastProvider } from '../../components';
import { Companies } from './Companies';

function renderCompanies() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return render(<Wrap><Companies /></Wrap>);
}

describe('Companies', () => {
  it('lists companies', async () => {
    renderCompanies();
    expect(await screen.findByText('Mock Co')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('creates a company', async () => {
    renderCompanies();
    await screen.findByText('Mock Co');
    await userEvent.type(screen.getByLabelText(/name/i), 'Newco');
    await userEvent.type(screen.getByLabelText(/code/i), 'new');
    await userEvent.click(screen.getByRole('button', { name: /add company/i }));
    expect(await screen.findByText(/company created/i)).toBeInTheDocument();
  });

  it('opens the quota modal', async () => {
    renderCompanies();
    await screen.findByText('Mock Co');
    await userEvent.click(screen.getAllByRole('button', { name: /manage quota/i })[0]);
    expect(await screen.findByText(/^quota —/i)).toBeInTheDocument();
    expect(await screen.findByText(/20 slots/i)).toBeInTheDocument();
  });

  it('closes the quota dialog after setting a quota (no manual close needed)', async () => {
    renderCompanies();
    await screen.findByText('Mock Co');
    await userEvent.click(screen.getAllByRole('button', { name: /manage quota/i })[0]);
    expect(await screen.findByText(/^quota —/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^slots$/i), '30');
    await userEvent.click(screen.getByRole('button', { name: /set quota/i }));

    // On success the dialog closes on its own; the invalidated summary refreshes the table behind it.
    await waitFor(() => expect(screen.queryByText(/^quota —/i)).not.toBeInTheDocument());
  });
});

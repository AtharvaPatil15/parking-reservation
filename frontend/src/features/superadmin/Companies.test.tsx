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

  // The toggle's label names the resulting state, so an ACTIVE company offers "Disable" and the
  // INACTIVE seeded one (Globex) offers "Enable".
  it('disables an active company and flips its badge', async () => {
    renderCompanies();
    await screen.findByText('Mock Co');
    await userEvent.click(screen.getAllByRole('button', { name: /^disable$/i })[0]);

    expect(await screen.findByText(/mock co disabled/i)).toBeInTheDocument();
    // Row now offers the inverse action, and the status column has caught up.
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^enable$/i })).toHaveLength(2));
  });

  it('enables an inactive company', async () => {
    renderCompanies();
    await screen.findByText('Globex');
    await userEvent.click(screen.getByRole('button', { name: /^enable$/i }));
    expect(await screen.findByText(/globex enabled/i)).toBeInTheDocument();
  });

  it('deletes a company with no users or live bookings', async () => {
    renderCompanies();
    await screen.findByText('Globex');
    // Globex is the third row; delete buttons follow the table order.
    await userEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[2]);

    expect(await screen.findByText(/delete globex\?/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /delete company/i }));

    expect(await screen.findByText(/globex deleted/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Globex')).not.toBeInTheDocument());
  });

  it('keeps the dialog open and shows the server reason when the company still has users', async () => {
    renderCompanies();
    await screen.findByText('Mock Co');
    await userEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]);
    await screen.findByText(/delete mock co\?/i);
    await userEvent.click(screen.getByRole('button', { name: /delete company/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/still has 5 users/i);
    // Still open, and the row survives — nothing was deleted optimistically.
    expect(screen.getByText(/delete mock co\?/i)).toBeInTheDocument();
    expect(screen.getByText('Mock Co')).toBeInTheDocument();
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

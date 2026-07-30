import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { ToastProvider } from '../../components';
import { Slots } from './Slots';

function renderSlots() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return render(<Wrap><Slots /></Wrap>);
}

describe('Slots', () => {
  it('lists slots', async () => {
    renderSlots();
    expect(await screen.findByText('A-12')).toBeInTheDocument();
  });

  it('creates a slot and shows it in the list without a reload', async () => {
    renderSlots();
    await screen.findByText('A-12');
    await userEvent.type(screen.getByLabelText(/slot number/i), 'A-99');
    await userEvent.click(screen.getByRole('button', { name: /add slot/i }));
    expect(await screen.findByText(/slot created/i)).toBeInTheDocument();
    // The list must refetch (invalidation) so the just-added slot is visible immediately.
    expect(await screen.findByText('A-99')).toBeInTheDocument();
  });

  it('offers the parking areas (Basement 1/2/3) to allocate a slot into', async () => {
    renderSlots();
    await screen.findByText('A-12');
    expect(await screen.findByRole('option', { name: 'Basement 1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Basement 2' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Basement 3' })).toBeInTheDocument();
  });

  it('creates a new parking area', async () => {
    renderSlots();
    await screen.findByText('A-12');
    await userEvent.type(screen.getByLabelText(/area name/i), 'Basement 4');
    await userEvent.click(screen.getByRole('button', { name: /add area/i }));
    expect(await screen.findByText(/parking area created/i)).toBeInTheDocument();
  });
});

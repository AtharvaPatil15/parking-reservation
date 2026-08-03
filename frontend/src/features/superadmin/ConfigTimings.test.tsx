import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { ToastProvider } from '../../components';
import { ConfigTimings } from './ConfigTimings';

function renderConfig() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return render(<Wrap><ConfigTimings /></Wrap>);
}

describe('ConfigTimings', () => {
  it('renders allocation schedule and weight fields from the config', async () => {
    renderConfig();
    expect(await screen.findByLabelText(/automatic allocation run interval/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/weekly allocation run day/i)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Monday' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Friday' })).toBeInTheDocument();
    expect(screen.getByLabelText(/weekly allocation run time/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/weight of the distance sub-score/i)).toBeInTheDocument();
    expect(screen.getByText(/next 5 runs/i)).toBeInTheDocument();
  });

  it('does not expose the raw config keys (function names) to the user', async () => {
    renderConfig();
    await screen.findByLabelText(/automatic allocation run interval/i);
    expect(screen.queryByText('booking.allocationRunFrequency')).not.toBeInTheDocument();
    expect(screen.queryByText('allocation.distanceWeight')).not.toBeInTheDocument();
    expect(screen.queryByText('carpool.maxPeople')).not.toBeInTheDocument();
  });

  it('does not show the old booking-window time card', async () => {
    renderConfig();
    await screen.findByLabelText(/automatic allocation run interval/i);
    expect(screen.queryByText(/^booking windows$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/primary window closes/i)).not.toBeInTheDocument();
  });

  it('flags an out-of-range weight inline', async () => {
    renderConfig();
    const weight = await screen.findByLabelText(/weight of the distance sub-score/i);
    fireEvent.change(weight, { target: { value: '2' } });
    expect(await screen.findByText(/between 0 and 1/i)).toBeInTheDocument();
  });

  it('saves a valid change and toasts', async () => {
    renderConfig();
    const weight = await screen.findByLabelText(/weight of the distance sub-score/i);
    fireEvent.change(weight, { target: { value: '0.7' } });
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/configuration saved/i)).toBeInTheDocument();
  });
});

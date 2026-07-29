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
  it('renders window-time and weight fields from the config', async () => {
    renderConfig();
    expect(await screen.findByLabelText(/primary window closes/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/weight of the distance sub-score/i)).toBeInTheDocument();
  });

  it('flags an out-of-range weight inline', async () => {
    renderConfig();
    const weight = await screen.findByLabelText(/weight of the distance sub-score/i);
    fireEvent.change(weight, { target: { value: '2' } });
    expect(await screen.findByText(/between 0 and 1/i)).toBeInTheDocument();
  });

  it('flags out-of-order booking times', async () => {
    renderConfig();
    const resultsBy = await screen.findByLabelText(/primary results published by/i);
    // Move "results by" before the cutoff (13:00) → violates the ordering rule.
    fireEvent.change(resultsBy, { target: { value: '12:00' } });
    // The rule is flagged inline on each timing field. Longer timeout: the full
    // parallel suite is CPU-heavy and the default 1s poll can lapse under load.
    expect((await screen.findAllByText(/out of order/i, {}, { timeout: 4000 })).length).toBeGreaterThan(0);
  });

  it('saves a valid change and toasts', async () => {
    renderConfig();
    const weight = await screen.findByLabelText(/weight of the distance sub-score/i);
    fireEvent.change(weight, { target: { value: '0.7' } });
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/configuration saved/i)).toBeInTheDocument();
  });
});

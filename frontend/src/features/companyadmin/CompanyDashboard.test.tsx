import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { CompanyDashboard } from './CompanyDashboard';

function renderDash() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<Wrap><CompanyDashboard /></Wrap>);
}

describe('CompanyDashboard', () => {
  it('renders headline counts', async () => {
    renderDash();
    expect(await screen.findByText('20')).toBeInTheDocument(); // company slots
    expect(screen.getByText('80%')).toBeInTheDocument(); // daily utilization
  });
});

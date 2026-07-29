import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { SuperAdminDashboard } from './SuperAdminDashboard';

function renderDash() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<Wrap><SuperAdminDashboard /></Wrap>);
}

describe('SuperAdminDashboard', () => {
  it('renders headline counts', async () => {
    renderDash();
    expect(await screen.findByText('120')).toBeInTheDocument(); // parking slots
    expect(screen.getByText('71.5%')).toBeInTheDocument(); // daily utilization
  });
});

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '../../mocks/node';
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

  it('shows the API error message when the dashboard request fails', async () => {
    server.use(
      http.get('*/api/v1/dashboard/company-admin', () =>
        HttpResponse.json(
          { success: false, error: { code: 'FORBIDDEN', message: 'Insufficient role for this operation' } },
          { status: 403 },
        ),
      ),
    );

    renderDash();

    expect(await screen.findByText(/couldn't load the dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/insufficient role/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

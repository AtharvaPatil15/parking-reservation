import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { ToastProvider } from '../../components';
import { AuthProvider, type AuthUser } from '../../lib/auth';
import { Blocks } from './Blocks';

const companyAdmin: AuthUser = {
  id: 'ca1', fullName: 'Cara Company', role: 'COMPANY_ADMIN', companyId: 'mock-co', companyName: 'Mock Co',
};

function renderBlocks() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <AuthProvider initialSession={{ accessToken: 't', user: companyAdmin }}>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
  return render(<Wrap><Blocks /></Wrap>);
}

describe('Blocks', () => {
  it('lists existing blocks', async () => {
    renderBlocks();
    expect(await screen.findByText(/quarterly offsite/i)).toBeInTheDocument();
  });

  it('creates a block', async () => {
    renderBlocks();
    await screen.findByText(/quarterly offsite/i);
    await userEvent.type(screen.getByLabelText(/^slots$/i), '2');
    await userEvent.click(screen.getByRole('button', { name: /add block/i }));
    expect(await screen.findByText(/block created/i)).toBeInTheDocument();
  });

  it('removes a block', async () => {
    renderBlocks();
    await screen.findByText(/quarterly offsite/i);
    await userEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(await screen.findByText(/block removed/i)).toBeInTheDocument();
  });
});

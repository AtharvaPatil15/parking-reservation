import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { ThemeProvider } from '../../lib/theme';
import { RegisterPage } from './RegisterPage';

function renderRegister() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
  return render(<Wrap><RegisterPage /></Wrap>);
}

async function fillValid(email = 'new@user.test') {
  await userEvent.type(screen.getByLabelText(/full name/i), 'New User');
  // company options load from GET /companies/active
  await screen.findByRole('option', { name: 'Mock Co' });
  await userEvent.selectOptions(screen.getByLabelText(/company/i), 'mock-co');
  await userEvent.type(screen.getByLabelText(/^email$/i), email);
  await userEvent.type(screen.getByLabelText(/contact number/i), '555-0100');
  await userEvent.type(screen.getByLabelText(/^address$/i), '1 Main St');
  await userEvent.type(screen.getByLabelText(/pin code/i), '560001');
  await userEvent.type(screen.getByLabelText(/^password$/i), 'password1');
  await userEvent.type(screen.getByLabelText(/confirm password/i), 'password1');
}

describe('RegisterPage', () => {
  it('renders the form with company options', async () => {
    renderRegister();
    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'Mock Co' })).toBeInTheDocument();
  });

  it('validates required fields', async () => {
    renderRegister();
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/full name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/email is required/i)).toBeInTheDocument();
  });

  it('flags mismatched passwords', async () => {
    renderRegister();
    await fillValid();
    await userEvent.clear(screen.getByLabelText(/confirm password/i));
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'different');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
  });

  it('submits and shows the pending-approval state', async () => {
    renderRegister();
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/registration submitted/i)).toBeInTheDocument();
    expect(screen.getByText(/pending approval/i)).toBeInTheDocument();
  });

  it('surfaces a duplicate-email conflict inline', async () => {
    renderRegister();
    await fillValid('priya@mock.test'); // already seeded in mock-co
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
  });
});

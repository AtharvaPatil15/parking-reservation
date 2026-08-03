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
  await userEvent.type(screen.getByLabelText(/contact number/i), '9000000123');
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

  it('shows the super-admin approval message for a company-admin registration', async () => {
    renderRegister();
    await fillValid('newadmin@user.test');
    await userEvent.selectOptions(screen.getByLabelText(/registering as/i), 'COMPANY_ADMIN');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/registration submitted/i)).toBeInTheDocument();
    expect(screen.getByText(/pending approval by the super admin/i)).toBeInTheDocument();
  });

  it('surfaces a duplicate-email conflict inline', async () => {
    renderRegister();
    await fillValid('priya@mock.test'); // already seeded in mock-co
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
  });

  /**
   * Phase 7 (D15) — the SECURITY persona. A gate operator has no tenant to pick and no commute to
   * record, so the form collapses to name / number / registering-as / email / password / confirm.
   * Regression guard: `SECURITY` was in the dropdown and the success copy but missing from the client
   * zod enum, so choosing it failed with "Invalid enum value. Expected 'EMPLOYEE' | 'COMPANY_ADMIN'".
   */
  describe('security registration', () => {
    async function chooseSecurity() {
      // Wait for the company select to exist first, so its later removal is a real assertion.
      await screen.findByRole('option', { name: 'Mock Co' });
      await userEvent.selectOptions(screen.getByLabelText(/registering as/i), 'SECURITY');
    }

    it('hides the fields a guard does not supply', async () => {
      renderRegister();
      await chooseSecurity();
      expect(screen.queryByLabelText(/company/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/^address$/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/pin code/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/distance/i)).not.toBeInTheDocument();
    });

    it('keeps exactly the six fields a guard does supply', async () => {
      renderRegister();
      await chooseSecurity();
      for (const label of [/full name/i, /registering as/i, /^email$/i, /contact number/i, /^password$/i, /confirm password/i]) {
        expect(screen.getByLabelText(label)).toBeInTheDocument();
      }
    });

    it('submits without a company and reports super-admin approval', async () => {
      renderRegister();
      await chooseSecurity();
      await userEvent.type(screen.getByLabelText(/full name/i), 'Gate Guard');
      await userEvent.type(screen.getByLabelText(/^email$/i), 'guard@building.test');
      await userEvent.type(screen.getByLabelText(/contact number/i), '9000000999');
      await userEvent.type(screen.getByLabelText(/^password$/i), 'password1');
      await userEvent.type(screen.getByLabelText(/confirm password/i), 'password1');
      await userEvent.click(screen.getByRole('button', { name: /create account/i }));

      expect(await screen.findByText(/registration submitted/i)).toBeInTheDocument();
      expect(screen.getByText(/security request is pending approval by the super admin/i)).toBeInTheDocument();
    });

    it('still enforces the fields it does keep', async () => {
      renderRegister();
      await chooseSecurity();
      await userEvent.click(screen.getByRole('button', { name: /create account/i }));
      expect(await screen.findByText(/full name is required/i)).toBeInTheDocument();
      expect(screen.getByText(/email is required/i)).toBeInTheDocument();
      // ...but must not demand what it no longer asks for.
      expect(screen.queryByText(/select your company/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/pin code is required/i)).not.toBeInTheDocument();
    });
  });
});

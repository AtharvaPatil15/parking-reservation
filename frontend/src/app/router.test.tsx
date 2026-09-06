import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { AppRouter } from './router';
import { AuthProvider, type AuthUser } from '../lib/auth';
import { ThemeProvider } from '../lib/theme';
import { ToastProvider } from '../components';

describe('routing + guards (integration)', () => {
  it('logs in as Super Admin and lands on the admin area with a sign-out control', async () => {
    render(<App />);
    await userEvent.type(await screen.findByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/password/i), 'pw');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('heading', { name: /^super admin$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('signing out returns to the login page', async () => {
    render(<App />);
    await userEvent.type(await screen.findByLabelText(/username/i), 'user');
    await userEvent.type(screen.getByLabelText(/password/i), 'pw');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('button', { name: /sign out/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(await screen.findByRole('heading', { name: /^sign in$/i })).toBeInTheDocument();
  });
});

// These tests render the real AppRouter (not a synthetic route tree) but need to seed
// auth state per-case, so they build their own provider stack — mirroring guards.test.tsx —
// with MemoryRouter (instead of App's BrowserRouter) so `initialEntries` can be set.
const companyAdmin: AuthUser = {
  id: 'c1',
  fullName: 'Cara Company',
  role: 'COMPANY_ADMIN',
  companyId: 'co1',
  companyName: 'Acme',
};

function renderRouterAt(path: string, user: AuthUser | null) {
  // A QueryClientProvider is required here (not just for App): the anonymous case renders
  // LoginPage via RootRedirect, and LoginPage now calls useLogin() (useMutation) since P5-05.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider initialSession={user ? { accessToken: 't', user } : null}>
          <ToastProvider>
            <MemoryRouter initialEntries={[path]}>
              <AppRouter />
            </MemoryRouter>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('RootRedirect (real router)', () => {
  it('anonymous at / is redirected to /login', async () => {
    renderRouterAt('/', null);
    expect(await screen.findByRole('heading', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('a seeded COMPANY_ADMIN session at / is redirected to /company', async () => {
    renderRouterAt('/', companyAdmin);
    expect(await screen.findByRole('heading', { name: /^company admin$/i })).toBeInTheDocument();
  });
});

describe('RequireRole wrong-role bounce (real router)', () => {
  it('a COMPANY_ADMIN visiting /admin is bounced to their own home (/company)', async () => {
    renderRouterAt('/admin', companyAdmin);
    expect(await screen.findByRole('heading', { name: /^company admin$/i })).toBeInTheDocument();
  });
});

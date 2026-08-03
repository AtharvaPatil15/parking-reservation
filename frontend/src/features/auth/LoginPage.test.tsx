import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../mocks/node';
import { ThemeProvider } from '../../lib/theme';
import { AuthProvider } from '../../lib/auth';
import { LoginPage } from './LoginPage';

function renderLogin(entry: { pathname: string; state?: unknown } | string = '/login') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={[entry]}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/admin" element={<div>Admin area</div>} />
              <Route path="/app" element={<div>User area</div>} />
              <Route path="/app/deep" element={<div>Deep user page</div>} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('LoginPage', () => {
  it('renders the form', () => {
    renderLogin();
    expect(screen.getByRole('heading', { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('shows validation errors on empty submit and does not navigate', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText('Email is required.')).toBeInTheDocument();
    expect(screen.getByText('Password is required.')).toBeInTheDocument();
    expect(screen.queryByText('Admin area')).not.toBeInTheDocument();
  });

  it('logs in a super admin and routes to /admin', async () => {
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'admin@acme.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'pw');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText('Admin area')).toBeInTheDocument();
  });

  it('shows a form error on 401 and does not navigate', async () => {
    server.use(
      http.post('*/api/v1/auth/login', () =>
        HttpResponse.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'bad' } }, { status: 401 }),
      ),
    );
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'admin@acme.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid email or password/i);
    expect(screen.queryByText('Admin area')).not.toBeInTheDocument();
  });

  it('ignores the guarded "from" path and routes to the user home after login', async () => {
    renderLogin({ pathname: '/login', state: { from: { pathname: '/app/deep' } } });
    await userEvent.type(screen.getByLabelText(/email/i), 'user@acme.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'pw');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText('User area')).toBeInTheDocument();
    expect(screen.queryByText('Deep user page')).not.toBeInTheDocument();
  });
});

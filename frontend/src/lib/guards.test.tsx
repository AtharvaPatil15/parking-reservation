import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthProvider, type AuthSession, type AuthUser } from './auth';
import { RequireAuth, RequireRole } from './guards';

const superAdmin: AuthUser = { id: '1', fullName: 'Sam Super', role: 'SUPER_ADMIN', companyId: null, companyName: 'HQ' };
const normalUser: AuthUser = { id: '2', fullName: 'Uma User', role: 'USER', companyId: 'c1', companyName: 'Acme' };
const sessionFor = (user: AuthUser): AuthSession => ({ accessToken: 'tok', user });

function renderAt(path: string, session: AuthSession | null) {
  return render(
    <AuthProvider initialSession={session}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<div>Login page</div>} />
          <Route path="/app" element={<div>User home</div>} />
          <Route element={<RequireRole role="SUPER_ADMIN" />}>
            <Route path="/admin" element={<div>Admin content</div>} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route path="/secure" element={<div>Secure content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('guards', () => {
  it('sends unauthenticated users on a role route to /login', () => {
    renderAt('/admin', null);
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('bounces a wrong-role user to their own home', () => {
    renderAt('/admin', sessionFor(normalUser));
    expect(screen.getByText('User home')).toBeInTheDocument();
  });

  it('renders content for the matching role', () => {
    renderAt('/admin', sessionFor(superAdmin));
    expect(screen.getByText('Admin content')).toBeInTheDocument();
  });

  it('RequireAuth blocks anonymous and allows any authenticated role', () => {
    renderAt('/secure', null);
    expect(screen.getByText('Login page')).toBeInTheDocument();
    renderAt('/secure', sessionFor(normalUser));
    expect(screen.getByText('Secure content')).toBeInTheDocument();
  });
});

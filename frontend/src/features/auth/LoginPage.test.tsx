import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../../lib/auth';
import { ThemeProvider } from '../../lib/theme';
import { LoginPage } from './LoginPage';

describe('LoginPage', () => {
  it('renders the sign-in heading and the temporary dev sign-in buttons', () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter>
            <LoginPage />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>,
    );
    // Exact match: /sign in/i alone also matches the "Developer sign-in" card title.
    expect(screen.getByRole('heading', { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in as super admin/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in as company admin/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in as user/i })).toBeInTheDocument();
  });
});

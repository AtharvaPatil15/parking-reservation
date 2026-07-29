import { act, render, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthProvider, useAuth, type AuthSession } from './auth';

const session: AuthSession = {
  accessToken: 'tok',
  user: { id: '1', fullName: 'Uma User', role: 'USER', companyId: 'c1', companyName: 'Acme' },
};

describe('AuthProvider', () => {
  it('starts unauthenticated', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.accessToken).toBeNull();
  });

  it('login sets user + token, logout clears them', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    act(() => result.current.login(session));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.fullName).toBe('Uma User');
    expect(result.current.accessToken).toBe('tok');
    act(() => result.current.logout());
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('honors initialSession', () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider initialSession={session}>{children}</AuthProvider>,
    });
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('throws when used outside a provider', () => {
    function Bad() {
      useAuth();
      return null;
    }
    expect(() => render(<Bad />)).toThrow(/AuthProvider/);
  });
});

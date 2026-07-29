import { useMutation } from '@tanstack/react-query';
import { api } from '../client';
import { unwrap } from '../http';
import { useAuth } from '../../lib/auth';
import type { components } from '../types';

type LoginResponseData = components['schemas']['LoginResponseData'];

/** POST /auth/login. Returns the session; the caller (P5-05) stores it + redirects. */
export function useLogin() {
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      unwrap<LoginResponseData>(api.POST('/auth/login', { body })),
  });
}

/** POST /auth/logout, then clear local auth regardless of network outcome. */
export function useLogout() {
  const { logout } = useAuth();
  return useMutation({
    mutationFn: () => unwrap<{ message: string }>(api.POST('/auth/logout', {})),
    onSettled: () => logout(),
  });
}

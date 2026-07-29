import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { unwrap } from '../http';
import { queryKeys } from '../queryKeys';
import { useAuth } from '../../lib/auth';
import type { components } from '../types';

type LoginResponseData = components['schemas']['LoginResponseData'];
type RegisterRequest = components['schemas']['RegisterRequest'];
type UserProfile = components['schemas']['UserProfile'];
type CompanySummary = components['schemas']['CompanySummary'];

/** POST /auth/login. Returns the session; the caller (P5-05) stores it + redirects. */
export function useLogin() {
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      unwrap<LoginResponseData>(api.POST('/auth/login', { body })),
  });
}

/** POST /auth/register — creates a PENDING user (awaits Company-Admin approval). Returns the profile, no token. */
export function useRegister() {
  return useMutation({
    mutationFn: (body: RegisterRequest) => unwrap<UserProfile>(api.POST('/auth/register', { body })),
  });
}

/** GET /companies/active — public id+name list for the registration company dropdown. */
export function useActiveCompanies() {
  return useQuery({
    queryKey: queryKeys.activeCompanies,
    queryFn: () => unwrap<CompanySummary[]>(api.GET('/companies/active', {})),
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

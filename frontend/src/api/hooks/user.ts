import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { unwrap } from '../http';
import { queryKeys } from '../queryKeys';
import type { components } from '../types';

type UserProfile = components['schemas']['UserProfile'];
type UserDashboard = components['schemas']['UserDashboard'];

/** GET /me — the signed-in user's profile (incl. distanceKm). */
export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: () => unwrap<UserProfile>(api.GET('/me', {})) });
}

/** GET /dashboard/user — upcoming booking, cutoff countdown, history count. */
export function useUserDashboard() {
  return useQuery({
    queryKey: queryKeys.userDashboard,
    queryFn: () => unwrap<UserDashboard>(api.GET('/dashboard/user', {})),
  });
}

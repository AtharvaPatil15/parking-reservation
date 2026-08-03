import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { unwrap, unwrapPage } from '../http';
import { queryKeys } from '../queryKeys';
import type { components } from '../types';

type UserProfile = components['schemas']['UserProfile'];
type UserDashboard = components['schemas']['UserDashboard'];
type Booking = components['schemas']['Booking'];

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

/** GET /me/bookings — paged history for the current user. */
export function useMyBookings(page = 1, pageSize = 10, status = '') {
  return useQuery({
    queryKey: queryKeys.myBookings(page, pageSize, status),
    queryFn: () =>
      unwrapPage<Booking>(
        api.GET('/me/bookings', {
          params: { query: { page, pageSize, ...(status ? { status: status as Booking['status'] } : {}) } },
        }),
      ),
    placeholderData: (prev) => prev,
  });
}

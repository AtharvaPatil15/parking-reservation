import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { unwrap, unwrapPage } from '../http';
import { queryKeys } from '../queryKeys';
import type { components } from '../types';

type UserProfile = components['schemas']['UserProfile'];
type UserDashboard = components['schemas']['UserDashboard'];
type Booking = components['schemas']['Booking'];
type VehicleSummary = components['schemas']['VehicleSummary'];
type UpdateProfileRequest = components['schemas']['UpdateProfileRequest'];
type CreateMyVehicleRequest = components['schemas']['CreateMyVehicleRequest'];
type UpdateMyVehicleRequest = components['schemas']['UpdateMyVehicleRequest'];

/** GET /me — the signed-in user's profile (incl. distanceKm). */
export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: () => unwrap<UserProfile>(api.GET('/me', {})) });
}

/** GET /dashboard/user — upcoming booking, cutoff countdown, history count. */
/** PATCH /me - update the signed-in user's editable profile fields. */
export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfileRequest) => unwrap<UserProfile>(api.PATCH('/me', { body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

/** GET /me/vehicles - the signed-in user's saved cars. */
export function useMyVehicles() {
  return useQuery({
    queryKey: queryKeys.myVehicles,
    queryFn: () => unwrap<VehicleSummary[]>(api.GET('/me/vehicles', {})),
  });
}

/** POST /me/vehicles - add/reactivate a saved car and make it visible to security. */
export function useCreateMyVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMyVehicleRequest) => unwrap<VehicleSummary>(api.POST('/me/vehicles', { body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.myVehicles });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
}

/** PATCH /me/vehicles/:id - edit a saved car, including its number. Partial: only sent fields change. */
export function useUpdateMyVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateMyVehicleRequest & { id: string }) =>
      unwrap<VehicleSummary>(api.PATCH('/me/vehicles/{id}', { params: { path: { id } }, body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.myVehicles });
      // The registry the gate reads from moved too, so drop its cache as create/remove do.
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
}

/** DELETE /me/vehicles/:id - remove a saved car from active security lookup. */
export function useRemoveMyVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap<{ id?: string }>(api.DELETE('/me/vehicles/{id}', { params: { path: { id } } })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.myVehicles });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
}

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

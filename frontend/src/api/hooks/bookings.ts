import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { unwrap } from '../http';
import { queryKeys } from '../queryKeys';
import type { components } from '../types';

type CreateBookingRequest = components['schemas']['CreateBookingRequest'];
type BookingCreatedData = components['schemas']['BookingCreatedData'];
type BookingDetail = components['schemas']['BookingDetail'];

/** POST /bookings. */
export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBookingRequest) =>
      unwrap<BookingCreatedData>(api.POST('/bookings', { body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.userDashboard });
      qc.invalidateQueries({ queryKey: ['me', 'bookings'] });
    },
  });
}

/** GET /bookings/{id} — full detail incl. carpool members + score breakdown. */
export function useBooking(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.booking(id) : ['booking', 'none'],
    queryFn: () => unwrap<BookingDetail>(api.GET('/bookings/{id}', { params: { path: { id: id! } } })),
    enabled: Boolean(id),
  });
}

/** POST /bookings/{id}/release — release an allocated slot (MVP). Returns the updated booking. */
export function useReleaseBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap<BookingDetail>(api.POST('/bookings/{id}/release', { params: { path: { id } } })),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: queryKeys.booking(id) });
      qc.invalidateQueries({ queryKey: queryKeys.userDashboard });
      qc.invalidateQueries({ queryKey: ['me', 'bookings'] });
    },
  });
}

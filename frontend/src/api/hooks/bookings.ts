import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { unwrap, unwrapPage, type PageMeta } from '../http';
import { queryKeys } from '../queryKeys';
import type { components } from '../types';

type CreateBookingRequest = components['schemas']['CreateBookingRequest'];
type UpdateBookingRequest = components['schemas']['UpdateBookingRequest'];
type BookingCreatedData = components['schemas']['BookingCreatedData'];
type BookingDetail = components['schemas']['BookingDetail'];
type AdminBooking = components['schemas']['AdminBooking'];

export interface AdminBookingsFilter {
  date?: string;
  companyId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * GET /bookings — admin roster (who booked, when, status, slot). COMPANY_ADMIN is scoped to
 * their own company server-side; SUPER_ADMIN sees all and may pass `companyId`/`date` filters.
 */
export function useAdminBookings(filter: AdminBookingsFilter = {}) {
  const { date, companyId, page = 1, pageSize = 20 } = filter;
  return useQuery<{ items: AdminBooking[]; meta: PageMeta }>({
    queryKey: queryKeys.adminBookings(date ?? '', companyId ?? '', page),
    queryFn: () =>
      unwrapPage<AdminBooking>(
        api.GET('/bookings', {
          params: {
            query: {
              page,
              pageSize,
              ...(date ? { date } : {}),
              ...(companyId ? { companyId } : {}),
            },
          },
        }),
      ),
  });
}

/** POST /bookings. */
export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBookingRequest) =>
      unwrap<BookingCreatedData>(api.POST('/bookings', { body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.userDashboard });
      qc.invalidateQueries({ queryKey: ['me', 'bookings'] });
      qc.invalidateQueries({ queryKey: ['bookings', 'admin'] }); // new booking shows on admin rosters
    },
  });
}

/** PATCH /bookings/{id} — edit an own, still-pending booking before the primary cutoff. */
export function useUpdateBooking(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateBookingRequest) =>
      unwrap<BookingDetail>(api.PATCH('/bookings/{id}', { params: { path: { id } }, body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.booking(id) });
      qc.invalidateQueries({ queryKey: queryKeys.userDashboard });
      qc.invalidateQueries({ queryKey: ['me', 'bookings'] });
      qc.invalidateQueries({ queryKey: ['bookings', 'admin'] });
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

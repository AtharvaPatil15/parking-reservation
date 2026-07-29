import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { unwrap } from '../http';
import { queryKeys } from '../queryKeys';
import type { components } from '../types';

type CreateBookingRequest = components['schemas']['CreateBookingRequest'];
type BookingCreatedData = components['schemas']['BookingCreatedData'];

/** POST /bookings. */
export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBookingRequest) =>
      unwrap<BookingCreatedData>(api.POST('/bookings', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.bookings }),
  });
}

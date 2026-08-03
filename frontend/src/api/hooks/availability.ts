import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { unwrap } from '../http';
import { queryKeys } from '../queryKeys';
import type { components } from '../types';

type AvailabilityResponse = components['schemas']['AvailabilityResponse'];

export interface AvailabilityRange {
  from?: string;
  to?: string;
}

/**
 * GET /availability — the slot grid plus the booking-window summary (Phase 7 §4).
 *
 * With no range it returns exactly the currently-open window, which is what the booking form wants.
 * `staleTime` is deliberately short: capacity moves as other people book, and a stale grid would let
 * someone submit against a slot that has just gone.
 */
export function useAvailability(range: AvailabilityRange = {}) {
  const { from, to } = range;
  return useQuery<AvailabilityResponse>({
    queryKey: queryKeys.availability(from ?? '', to ?? ''),
    queryFn: () =>
      unwrap<AvailabilityResponse>(
        api.GET('/availability', {
          params: { query: { ...(from ? { from } : {}), ...(to ? { to } : {}) } },
        }),
      ),
    staleTime: 15_000,
  });
}

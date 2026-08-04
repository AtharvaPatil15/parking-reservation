import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { unwrap, unwrapPage, type PageMeta } from '../http';
import { queryKeys } from '../queryKeys';
import { DEFAULT_PAGE_SIZE } from '../pagination';
import type { components } from '../types';

type VehicleSummary = components['schemas']['VehicleSummary'];
type GateLookup = components['schemas']['GateLookup'];
type GateEvent = components['schemas']['GateEvent'];
type GateCheckInRequest = components['schemas']['GateCheckInRequest'];
type GateCheckOutRequest = components['schemas']['GateCheckOutRequest'];

/** Invalidate everything a check-in/out changes: the gate log and both admin unbooked feeds. */
function invalidateGate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['gate'] });
  qc.invalidateQueries({ queryKey: queryKeys.companyAdminDashboard });
  qc.invalidateQueries({ queryKey: queryKeys.superAdminDashboard });
}

/** GET /vehicles?search= — typeahead for the car-number field. Skipped until 2+ characters. */
export function useVehicleSearch(search: string) {
  const term = search.trim();
  return useQuery<VehicleSummary[]>({
    queryKey: queryKeys.vehicleSearch(term),
    queryFn: () => unwrap<VehicleSummary[]>(api.GET('/vehicles', { params: { query: { search: term } } })),
    enabled: term.length >= 2,
    staleTime: 60_000,
  });
}

/**
 * GET /vehicles/lookup?number= — owner, today's booking, and open-visit state for one plate.
 *
 * `retry: false` on purpose: a 400 for a too-short number is a normal state while the guard is still
 * typing, and retrying it just delays the real answer.
 */
export function useVehicleLookup(vehicleNumber: string | undefined) {
  const term = (vehicleNumber ?? '').trim();
  return useQuery<GateLookup>({
    queryKey: queryKeys.vehicleLookup(term),
    queryFn: () => unwrap<GateLookup>(api.GET('/vehicles/lookup', { params: { query: { number: term } } })),
    enabled: term.length >= 4,
    retry: false,
    staleTime: 0,
  });
}

/** POST /gate/check-in. Resolves with `hadBooking` so the caller can warn about an unbooked entry. */
export function useGateCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GateCheckInRequest) => unwrap<GateEvent>(api.POST('/gate/check-in', { body })),
    onSuccess: () => invalidateGate(qc),
  });
}

/** POST /gate/check-out. */
export function useGateCheckOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GateCheckOutRequest) => unwrap<GateEvent>(api.POST('/gate/check-out', { body })),
    onSuccess: () => invalidateGate(qc),
  });
}

export interface GateEventsFilter {
  date?: string;
  status?: 'CHECKED_IN' | 'CHECKED_OUT';
  page?: number;
  pageSize?: number;
}

/** GET /gate/events — today's gate log (building-wide). */
export function useGateEvents(filter: GateEventsFilter = {}) {
  const { date, status, page = 1, pageSize = DEFAULT_PAGE_SIZE } = filter;
  return useQuery<{ items: GateEvent[]; meta: PageMeta }>({
    queryKey: queryKeys.gateEvents(date ?? '', status ?? '', page),
    queryFn: () =>
      unwrapPage<GateEvent>(
        api.GET('/gate/events', {
          params: {
            query: { page, pageSize, ...(date ? { date } : {}), ...(status ? { status } : {}) },
          },
        }),
      ),
  });
}

export interface UnbookedFilter {
  date?: string;
  companyId?: string;
  page?: number;
  pageSize?: number;
}

/** GET /gate/unbooked — entries let through without a booking (D16). CA own company / SA all. */
export function useUnbookedEntries(filter: UnbookedFilter = {}) {
  const { date, companyId, page = 1, pageSize = DEFAULT_PAGE_SIZE } = filter;
  return useQuery<{ items: GateEvent[]; meta: PageMeta }>({
    queryKey: queryKeys.unbookedEntries(date ?? '', companyId ?? '', page),
    queryFn: () =>
      unwrapPage<GateEvent>(
        api.GET('/gate/unbooked', {
          params: {
            query: { page, pageSize, ...(date ? { date } : {}), ...(companyId ? { companyId } : {}) },
          },
        }),
      ),
  });
}

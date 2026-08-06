import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { unwrap, unwrapPage, type PageMeta } from '../http';
import { queryKeys } from '../queryKeys';
import type { components, paths } from '../types';

type VehicleSummary = components['schemas']['VehicleSummary'];
type GateLookup = components['schemas']['GateLookup'];
type GateEvent = components['schemas']['GateEvent'];
type GateCheckInRequest = components['schemas']['GateCheckInRequest'];
type GateCheckOutRequest = components['schemas']['GateCheckOutRequest'];
type GateCapacity = components['schemas']['GateCapacity'];
type VehicleRegistration = components['schemas']['VehicleRegistration'];
type UserDetail = components['schemas']['UserDetail'];
type CreateRegistrationBody =
  paths['/vehicles/registrations']['post']['requestBody']['content']['application/json'];

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
  const { date, status, page = 1, pageSize = 20 } = filter;
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

/** GET /gate/capacity — per-company slots / booked / free / inside for the gate's landing page. */
export function useGateCapacity(date?: string) {
  return useQuery<GateCapacity>({
    queryKey: queryKeys.gateCapacity(date ?? ''),
    queryFn: () =>
      unwrap<GateCapacity>(api.GET('/gate/capacity', { params: { query: date ? { date } : {} } })),
    // A guard reads this to decide whether to admit a car, so a stale count is worse than a refetch.
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export interface RegistrationsFilter {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  companyId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * GET /vehicles/registrations — walk-in requests, scoped server-side by role.
 *
 * The guard polls it: their car is held at the barrier until the request comes back APPROVED, and
 * nothing pushes that to them (the notification service is unbuilt).
 */
export function useVehicleRegistrations(filter: RegistrationsFilter = {}) {
  const { status, companyId, page = 1, pageSize = 10 } = filter;
  return useQuery<{ items: VehicleRegistration[]; meta: PageMeta }>({
    queryKey: queryKeys.vehicleRegistrations(status ?? '', companyId ?? '', page),
    queryFn: () =>
      unwrapPage<VehicleRegistration>(
        api.GET('/vehicles/registrations', {
          params: {
            query: { page, pageSize, ...(status ? { status } : {}), ...(companyId ? { companyId } : {}) },
          },
        }),
      ),
    refetchInterval: 60_000,
  });
}

/** POST /vehicles/registrations — security registers a walk-in car. */
export function useCreateVehicleRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRegistrationBody) =>
      unwrap<VehicleRegistration>(api.POST('/vehicles/registrations', { body })),
    onSuccess: () => invalidateGate(qc),
  });
}

/** POST /vehicles/registrations/{id}/decision — the admin's approve/reject. */
export function useDecideVehicleRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'APPROVE' | 'REJECT'; note?: string }) =>
      unwrap<VehicleRegistration>(
        api.POST('/vehicles/registrations/{id}/decision', {
          params: { path: { id } },
          body: { decision, ...(note ? { note } : {}) },
        }),
      ),
    // Approving creates a Vehicle, which changes what a plate lookup returns — drop the gate cache too.
    onSuccess: () => invalidateGate(qc),
  });
}

/** GET /users/{id} — the full applicant for the approval screens' details dialog. */
export function useUserDetail(userId: string | null) {
  return useQuery<UserDetail>({
    queryKey: queryKeys.userDetail(userId ?? ''),
    queryFn: () =>
      unwrap<UserDetail>(api.GET('/users/{id}', { params: { path: { id: userId! } } })),
    // Only fetched once the dialog is actually open.
    enabled: Boolean(userId),
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
  const { date, companyId, page = 1, pageSize = 20 } = filter;
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

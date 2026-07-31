import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { unwrap, unwrapPage, type PageMeta } from '../http';
import { queryKeys } from '../queryKeys';
import type { components } from '../types';

type AllocationRunSummary = components['schemas']['AllocationRunSummary'];
type AllocationBreakdown = components['schemas']['AllocationBreakdown'];
type AllocationRosterItem = components['schemas']['AllocationRosterItem'];

/** Invalidate everything a completed allocation run changes: rosters, dashboards, the seat roster. */
function invalidateAfterRun(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['bookings', 'admin'] });
  qc.invalidateQueries({ queryKey: ['allocations'] });
  qc.invalidateQueries({ queryKey: ['allocationRun', 'byDate'] }); // flip the run to "done" for its date
  qc.invalidateQueries({ queryKey: queryKeys.superAdminDashboard });
  qc.invalidateQueries({ queryKey: queryKeys.companyAdminDashboard });
}

/** POST /allocation/primary/run — returns the run summary (use `.id` for the breakdown). */
export function useRunPrimaryAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { bookingDate: string }) =>
      unwrap<AllocationRunSummary>(api.POST('/allocation/primary/run', { body })),
    onSuccess: () => invalidateAfterRun(qc),
  });
}

/** POST /allocation/common-pool/run — distributes unused slots cross-company; returns the run summary. */
export function useRunCommonPoolAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { bookingDate: string }) =>
      unwrap<AllocationRunSummary>(api.POST('/allocation/common-pool/run', { body })),
    onSuccess: () => invalidateAfterRun(qc),
  });
}

export interface AllocationsFilter {
  date?: string;
  companyId?: string;
  type?: 'PRIMARY' | 'COMMON_POOL';
  page?: number;
  pageSize?: number;
}

/**
 * GET /allocations — per-slot roster (who holds which seat, primary vs common pool). COMPANY_ADMIN is
 * scoped to their own company server-side; SUPER_ADMIN sees all and may pass `companyId`/`type`/`date`.
 */
export function useAllocations(filter: AllocationsFilter = {}) {
  const { date, companyId, type, page = 1, pageSize = 20 } = filter;
  return useQuery<{ items: AllocationRosterItem[]; meta: PageMeta }>({
    queryKey: queryKeys.allocations(date ?? '', companyId ?? '', type ?? '', page),
    queryFn: () =>
      unwrapPage<AllocationRosterItem>(
        api.GET('/allocations', {
          params: {
            query: {
              page,
              pageSize,
              ...(date ? { date } : {}),
              ...(companyId ? { companyId } : {}),
              ...(type ? { type } : {}),
            },
          },
        }),
      ),
  });
}

/**
 * GET /allocation/runs?date=&type= — the existing run for a date+type, or null if not yet run.
 * Lets the UI show stored results and disable a redundant re-run once allocation is done.
 */
export function useAllocationRunForDate(date: string, type: 'PRIMARY' | 'COMMON_POOL') {
  return useQuery<AllocationRunSummary | null>({
    queryKey: ['allocationRun', 'byDate', type, date],
    queryFn: () =>
      unwrap<AllocationRunSummary | null>(api.GET('/allocation/runs', { params: { query: { date, type } } })),
    enabled: Boolean(date),
  });
}

/** GET /allocation/runs/{id}/breakdown — enabled once a runId is known. */
export function useAllocationBreakdown(runId: string | undefined) {
  return useQuery({
    queryKey: runId ? queryKeys.allocationBreakdown(runId) : ['allocationRun', 'pending'],
    queryFn: () =>
      unwrap<AllocationBreakdown>(
        api.GET('/allocation/runs/{id}/breakdown', { params: { path: { id: runId! } } }),
      ),
    enabled: Boolean(runId),
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { unwrap, unwrapPage, type PageMeta } from '../http';
import { queryKeys } from '../queryKeys';
import type { components } from '../types';

type AllocationRunSummary = components['schemas']['AllocationRunSummary'];
type AllocationBreakdown = components['schemas']['AllocationBreakdown'];
type AllocationRosterItem = components['schemas']['AllocationRosterItem'];
type WeeklyRunResult = components['schemas']['WeeklyRunResult'];
type WeeklyRunPreview = components['schemas']['WeeklyRunPreview'];

/** Invalidate everything a completed allocation run changes: rosters, dashboards, the seat roster. */
function invalidateAfterRun(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['bookings', 'admin'] });
  qc.invalidateQueries({ queryKey: ['allocations'] });
  // Whole prefix: flips the run to "done" for its date AND refreshes the stored breakdown.
  qc.invalidateQueries({ queryKey: ['allocationRun'] });
  qc.invalidateQueries({ queryKey: queryKeys.superAdminDashboard });
  qc.invalidateQueries({ queryKey: queryKeys.companyAdminDashboard });
  // Phase 7: a run closes its band's dates for requests, so the grid and the band preview both move.
  qc.invalidateQueries({ queryKey: ['availability'] });
  qc.invalidateQueries({ queryKey: queryKeys.weeklyRunPreview });
}

/** GET /allocation/weekly — the band the next weekend batch owns, with pending counts per date. */
export function useWeeklyRunPreview() {
  return useQuery<WeeklyRunPreview>({
    queryKey: queryKeys.weeklyRunPreview,
    queryFn: () => unwrap<WeeklyRunPreview>(api.GET('/allocation/weekly')),
  });
}

/**
 * POST /allocation/weekly/run — the Phase 7 weekend batch. Takes no body: the band comes from
 * config, so there is no date for the caller to get wrong.
 */
export function useRunWeeklyAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap<WeeklyRunResult>(api.POST('/allocation/weekly/run')),
    onSuccess: () => invalidateAfterRun(qc),
  });
}

/**
 * POST /allocation/weekly/common-pool/run — the band-scoped common pool. Same no-body shape as the
 * weekly primary batch, and meant to be run after it: it redistributes every company's unused slots
 * across the building for each date in the band.
 */
export function useRunWeeklyCommonPoolAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap<WeeklyRunResult>(api.POST('/allocation/weekly/common-pool/run')),
    onSuccess: () => invalidateAfterRun(qc),
  });
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
    queryKey: queryKeys.allocationRunForDate(date, type),
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

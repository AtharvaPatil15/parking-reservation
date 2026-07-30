import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { unwrap } from '../http';
import { queryKeys } from '../queryKeys';
import type { components } from '../types';

type AllocationRunSummary = components['schemas']['AllocationRunSummary'];
type AllocationBreakdown = components['schemas']['AllocationBreakdown'];

/** POST /allocation/primary/run — returns the run summary (use `.id` for the breakdown). */
export function useRunPrimaryAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { bookingDate: string }) =>
      unwrap<AllocationRunSummary>(api.POST('/allocation/primary/run', { body })),
    onSuccess: () => {
      // Allocation flips SUBMITTED → ALLOCATED/WAITLISTED and assigns slots — refresh the rosters/dashboards.
      qc.invalidateQueries({ queryKey: ['bookings', 'admin'] });
      qc.invalidateQueries({ queryKey: queryKeys.superAdminDashboard });
      qc.invalidateQueries({ queryKey: queryKeys.companyAdminDashboard });
    },
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

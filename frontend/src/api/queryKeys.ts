/** Stable React Query keys. */
export const queryKeys = {
  config: ['config'] as const,
  bookings: ['bookings'] as const,
  booking: (id: string) => ['booking', id] as const,
  allocationBreakdown: (runId: string) => ['allocationRun', runId, 'breakdown'] as const,
};

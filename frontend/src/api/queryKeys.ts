/** Stable React Query keys. */
export const queryKeys = {
  config: ['config'] as const,
  bookings: ['bookings'] as const,
  booking: (id: string) => ['booking', id] as const,
  allocationBreakdown: (runId: string) => ['allocationRun', runId, 'breakdown'] as const,
  me: ['me'] as const,
  userDashboard: ['dashboard', 'user'] as const,
  myBookings: (page: number, pageSize: number) => ['me', 'bookings', page, pageSize] as const,
};

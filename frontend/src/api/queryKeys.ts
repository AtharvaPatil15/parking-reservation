/** Stable React Query keys. */
export const queryKeys = {
  config: ['config'] as const,
  booking: (id: string) => ['booking', id] as const,
  allocationBreakdown: (runId: string) => ['allocationRun', runId, 'breakdown'] as const,
  // Shares the 'allocationRun' prefix with allocationBreakdown so one invalidate covers both.
  allocationRunForDate: (date: string, type: string) => ['allocationRun', 'byDate', type, date] as const,
  allocations: (date: string, companyId: string, type: string, page: number) =>
    ['allocations', date, companyId, type, page] as const,
  me: ['me'] as const,
  userDashboard: ['dashboard', 'user'] as const,
  myBookings: (page: number, pageSize: number, status: string) => ['me', 'bookings', page, pageSize, status] as const,
  adminBookings: (date: string, companyId: string, page: number) =>
    ['bookings', 'admin', date, companyId, page] as const,

  // Auth / registration
  activeCompanies: ['companies', 'active'] as const,

  // Super Admin (P5-11)
  superAdminDashboard: ['dashboard', 'super-admin'] as const,
  pendingAdmins: (page: number, pageSize: number) => ['users', 'pending-admins', page, pageSize] as const,
  adminRequestHistory: (page: number, pageSize: number) =>
    ['users', 'admin-requests', 'history', page, pageSize] as const,
  companies: (page: number, pageSize: number) => ['companies', page, pageSize] as const,
  companiesQuotaSummary: (date: string) => ['companies', 'quota-summary', date] as const,
  slots: (page: number, pageSize: number, status: string) => ['slots', page, pageSize, status] as const,
  parkingAreas: ['parking-areas'] as const,
  companyQuota: (companyId: string) => ['companies', companyId, 'quota'] as const,

  // Booking window + slot grid (Phase 7)
  availability: (from: string, to: string) => ['availability', from, to] as const,
  weeklyRunPreview: ['allocation', 'weekly'] as const,

  // Gate / security persona (Phase 7)
  vehicleSearch: (search: string) => ['vehicles', 'search', search] as const,
  vehicleLookup: (number: string) => ['vehicles', 'lookup', number] as const,
  gateEvents: (date: string, status: string, page: number) => ['gate', 'events', date, status, page] as const,
  unbookedEntries: (date: string, companyId: string, page: number) =>
    ['gate', 'unbooked', date, companyId, page] as const,

  // Company-scoped (P5-11 drill-in + P5-12 company admin)
  companyAdminDashboard: ['dashboard', 'company-admin'] as const,
  companyUsers: (companyId: string, page: number, pageSize: number, status: string) =>
    ['companies', companyId, 'users', page, pageSize, status] as const,
  blocks: (companyId: string, page: number, pageSize: number) =>
    ['companies', companyId, 'blocks', page, pageSize] as const,
};

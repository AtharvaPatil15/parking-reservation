import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { unwrap, unwrapPage, type PageMeta } from '../http';
import { queryKeys } from '../queryKeys';
import type { components } from '../types';

type SuperAdminDashboard = components['schemas']['SuperAdminDashboard'];
type Company = components['schemas']['Company'];
type ParkingSlot = components['schemas']['ParkingSlot'];
type ParkingArea = components['schemas']['ParkingArea'];
type CompanyQuota = components['schemas']['CompanyQuota'];
type CompanyQuotaSummaryEntry = components['schemas']['CompanyQuotaSummaryEntry'];
type CreateSlotRequest = components['schemas']['CreateSlotRequest'];
type CreateQuotaRequest = components['schemas']['CreateQuotaRequest'];
type UserProfile = components['schemas']['UserProfile'];
type ApprovalDecision = components['schemas']['ApprovalDecision'];

/** GET /dashboard/super-admin — headline counts for the SA landing. `date` (YYYY-MM-DD) picks the
 *  business day for the daily figures; omit for today (IST). */
export function useSuperAdminDashboard(date?: string) {
  return useQuery({
    queryKey: [...queryKeys.superAdminDashboard, date ?? ''],
    queryFn: () =>
      unwrap<SuperAdminDashboard>(
        api.GET('/dashboard/super-admin', { params: { query: date ? { date } : {} } }),
      ),
  });
}

/** GET /companies/quota-summary — effective assigned slots per company for a date. */
export function useCompanyQuotaSummary(date: string) {
  return useQuery({
    queryKey: queryKeys.companiesQuotaSummary(date),
    queryFn: () =>
      unwrap<CompanyQuotaSummaryEntry[]>(
        api.GET('/companies/quota-summary', { params: { query: date ? { date } : {} } }),
      ),
  });
}

/** GET /companies — paged company list. */
export function useCompanies(page = 1, pageSize = 10) {
  return useQuery<{ items: Company[]; meta: PageMeta }>({
    queryKey: queryKeys.companies(page, pageSize),
    queryFn: () =>
      unwrapPage<Company>(api.GET('/companies', { params: { query: { page, pageSize } } })),
  });
}

/** POST /companies — create a tenant. */
export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; code: string }) =>
      unwrap<Company>(api.POST('/companies', { body })),
    // Only the paged company lists (`['companies', page, pageSize]`) — not the
    // company-scoped quota/users/blocks queries that share the 'companies' prefix.
    onSuccess: () =>
      qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'companies' && typeof q.queryKey[1] === 'number',
      }),
  });
}

/** GET /users/pending-admins — the Super Admin's pending company-admin request queue (F11). */
export function usePendingAdmins(page = 1, pageSize = 10) {
  return useQuery<{ items: UserProfile[]; meta: PageMeta }>({
    queryKey: queryKeys.pendingAdmins(page, pageSize),
    queryFn: () =>
      unwrapPage<UserProfile>(api.GET('/users/pending-admins', { params: { query: { page, pageSize } } })),
  });
}

/** PATCH /users/{id}/approval — approve/reject a pending company-admin request (SA queue). */
export function useApproveAdminRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, decision }: { userId: string; decision: ApprovalDecision }) =>
      unwrap<UserProfile>(api.PATCH('/users/{id}/approval', { params: { path: { id: userId } }, body: { decision } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users', 'pending-admins'] }),
  });
}

/** GET /slots — paged slot list, optionally filtered by status. */
export function useSlots(page = 1, pageSize = 10, status?: components['schemas']['SlotStatus']) {
  return useQuery<{ items: ParkingSlot[]; meta: PageMeta }>({
    queryKey: queryKeys.slots(page, pageSize, status ?? 'all'),
    queryFn: () =>
      unwrapPage<ParkingSlot>(
        api.GET('/slots', { params: { query: { page, pageSize, ...(status ? { status } : {}) } } }),
      ),
  });
}

/** GET /parking-areas — areas to choose from when creating a slot. */
export function useParkingAreas() {
  return useQuery({
    queryKey: queryKeys.parkingAreas,
    queryFn: () => unwrap<ParkingArea[]>(api.GET('/parking-areas', {})),
  });
}

/** POST /slots — create a parking slot. */
export function useCreateSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSlotRequest) => unwrap<ParkingSlot>(api.POST('/slots', { body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['slots'] });
      qc.invalidateQueries({ queryKey: queryKeys.superAdminDashboard });
    },
  });
}

/** PATCH /slots/{id} — update a slot (used here to activate/deactivate via status). */
export function useUpdateSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & components['schemas']['UpdateSlotRequest']) =>
      unwrap<ParkingSlot>(api.PATCH('/slots/{id}', { params: { path: { id } }, body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['slots'] });
      qc.invalidateQueries({ queryKey: queryKeys.superAdminDashboard });
    },
  });
}

/** DELETE /slots/{id} — soft-delete a slot (drops it from inventory + counts). */
export function useDeleteSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap<{ message: string }>(api.DELETE('/slots/{id}', { params: { path: { id } } })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['slots'] });
      qc.invalidateQueries({ queryKey: queryKeys.superAdminDashboard });
    },
  });
}

/** GET /companies/{id}/quota — effective-dated quota rows. */
export function useCompanyQuota(companyId: string | undefined) {
  return useQuery({
    queryKey: companyId ? queryKeys.companyQuota(companyId) : ['companies', 'pending', 'quota'],
    queryFn: () =>
      unwrap<CompanyQuota[]>(api.GET('/companies/{id}/quota', { params: { path: { id: companyId! } } })),
    enabled: Boolean(companyId),
  });
}

/** POST /companies/{id}/quota — set a new effective-dated quota row. */
export function useSetCompanyQuota(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateQuotaRequest) =>
      unwrap<CompanyQuota>(api.POST('/companies/{id}/quota', { params: { path: { id: companyId } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.companyQuota(companyId) }),
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { unwrap, unwrapPage, type PageMeta } from '../http';
import { queryKeys } from '../queryKeys';
import type { components } from '../types';

type SuperAdminDashboard = components['schemas']['SuperAdminDashboard'];
type Company = components['schemas']['Company'];
type ParkingSlot = components['schemas']['ParkingSlot'];
type CompanyQuota = components['schemas']['CompanyQuota'];
type CreateSlotRequest = components['schemas']['CreateSlotRequest'];
type CreateQuotaRequest = components['schemas']['CreateQuotaRequest'];

/** GET /dashboard/super-admin — headline counts for the SA landing. */
export function useSuperAdminDashboard() {
  return useQuery({
    queryKey: queryKeys.superAdminDashboard,
    queryFn: () => unwrap<SuperAdminDashboard>(api.GET('/dashboard/super-admin', {})),
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

/** POST /slots — create a parking slot. */
export function useCreateSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSlotRequest) => unwrap<ParkingSlot>(api.POST('/slots', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['slots'] }),
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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { unwrap, unwrapPage, type PageMeta } from '../http';
import { queryKeys } from '../queryKeys';
import type { components } from '../types';

type CompanyAdminDashboard = components['schemas']['CompanyAdminDashboard'];
type UserProfile = components['schemas']['UserProfile'];
type SlotBlock = components['schemas']['SlotBlock'];
type CreateBlockRequest = components['schemas']['CreateBlockRequest'];
type ApprovalDecision = components['schemas']['ApprovalDecision'];
type UserStatus = components['schemas']['UserStatus'];

/** GET /dashboard/company-admin — headline counts for the CA landing. `date` (YYYY-MM-DD) picks the
 *  business day for the daily figures; omit for today (IST). */
export function useCompanyAdminDashboard(date?: string) {
  return useQuery({
    queryKey: [...queryKeys.companyAdminDashboard, date ?? ''],
    queryFn: () =>
      unwrap<CompanyAdminDashboard>(
        api.GET('/dashboard/company-admin', { params: { query: date ? { date } : {} } }),
      ),
  });
}

/** GET /companies/{id}/users — paged company members, optionally filtered by status. */
export function useCompanyUsers(companyId: string | undefined, page = 1, pageSize = 10, status?: UserStatus) {
  return useQuery<{ items: UserProfile[]; meta: PageMeta }>({
    queryKey: companyId
      ? queryKeys.companyUsers(companyId, page, pageSize, status ?? 'all')
      : ['companies', 'pending', 'users'],
    queryFn: () =>
      unwrapPage<UserProfile>(
        api.GET('/companies/{id}/users', {
          params: { path: { id: companyId! }, query: { page, pageSize, ...(status ? { status } : {}) } },
        }),
      ),
    enabled: Boolean(companyId),
  });
}

/** PATCH /users/{id}/approval — approve/reject a pending member (invalidates the company user list). */
export function useSetUserApproval(companyId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, decision }: { userId: string; decision: ApprovalDecision }) =>
      unwrap<UserProfile>(api.PATCH('/users/{id}/approval', { params: { path: { id: userId } }, body: { decision } })),
    onSuccess: () => {
      if (companyId) qc.invalidateQueries({ queryKey: ['companies', companyId, 'users'] });
    },
  });
}

/** GET /companies/{id}/blocks — paged quota blocks. */
export function useBlocks(companyId: string | undefined, page = 1, pageSize = 10) {
  return useQuery<{ items: SlotBlock[]; meta: PageMeta }>({
    queryKey: companyId ? queryKeys.blocks(companyId, page, pageSize) : ['companies', 'pending', 'blocks'],
    queryFn: () =>
      unwrapPage<SlotBlock>(
        api.GET('/companies/{id}/blocks', { params: { path: { id: companyId! }, query: { page, pageSize } } }),
      ),
    enabled: Boolean(companyId),
  });
}

/** POST /companies/{id}/blocks — block a count of the company's quota. */
export function useCreateBlock(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBlockRequest) =>
      unwrap<SlotBlock>(api.POST('/companies/{id}/blocks', { params: { path: { id: companyId } }, body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies', companyId, 'blocks'] });
      qc.invalidateQueries({ queryKey: queryKeys.companyAdminDashboard }); // blocks change available/blocked counts
    },
  });
}

/** DELETE /blocks/{id} — remove a quota block. */
export function useDeleteBlock(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (blockId: string) =>
      unwrap<{ message: string }>(api.DELETE('/blocks/{id}', { params: { path: { id: blockId } } })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies', companyId, 'blocks'] });
      qc.invalidateQueries({ queryKey: queryKeys.companyAdminDashboard }); // unblocking frees quota back up
    },
  });
}

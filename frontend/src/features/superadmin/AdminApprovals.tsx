import { useState } from 'react';
import {
  Badge, Button, Card, EmptyState, ErrorState, LoadingState, Pager, Table, useToast,
  type Column,
} from '../../components';
import { usePendingAdmins, useAdminRequestHistory, useApproveAdminRequest, useRemovePrivilegedUser } from '../../api/hooks';
import type { components } from '../../api/types';

type UserProfile = components['schemas']['UserProfile'];

/**
 * Super Admin queue of pending company-admin registration requests (F11). Approving grants the
 * applicant the CompanyAdmin assignment for their (existing) company; rejecting marks them REJECTED.
 * Processed requests move to the persisted "Approval history" (GET /users/admin-requests/history),
 * so decisions stay visible after they leave the pending queue.
 */
export function AdminApprovals() {
  const [pendingPage, setPendingPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const requests = usePendingAdmins(pendingPage);
  const history = useAdminRequestHistory(historyPage);
  const approval = useApproveAdminRequest();
  const removeUser = useRemovePrivilegedUser();
  const { toast } = useToast();
  // Track the row currently mutating so only its buttons show a spinner.
  const [pendingId, setPendingId] = useState<string | null>(null);

  function decide(userId: string, decision: 'APPROVE' | 'REJECT') {
    setPendingId(userId);
    approval.mutate(
      { userId, decision },
      {
        onSuccess: () =>
          toast(decision === 'APPROVE' ? 'Company admin approved.' : 'Request rejected.', { tone: 'success' }),
        onError: () => toast('Could not update the request.', { tone: 'danger' }),
        onSettled: () => setPendingId(null),
      },
    );
  }

  function remove(userId: string, label: string) {
    if (!window.confirm(`Remove ${label}? This user will no longer be able to sign in.`)) return;
    setPendingId(userId);
    removeUser.mutate(userId, {
      onSuccess: () => toast('User removed.', { tone: 'success' }),
      onError: () => toast('Could not remove the user.', { tone: 'danger' }),
      onSettled: () => setPendingId(null),
    });
  }

  const columns: Column<UserProfile>[] = [
    { key: 'name', header: 'Name', render: (u) => <span className="font-medium text-text">{u.fullName}</span> },
    { key: 'email', header: 'Email', render: (u) => u.email },
    { key: 'company', header: 'Company', render: (u) => <Badge tone="neutral">{u.companyName}</Badge> },
    {
      key: 'role',
      header: 'Requested as',
      // Phase 7: the queue now mixes company-admin and security registrations, so the row must say
      // which — approving a gate operator is a different decision from granting company admin.
      render: (u) => (
        <Badge tone={u.role === 'SECURITY' ? 'accent' : 'primary'}>
          {u.role === 'SECURITY' ? 'Security' : 'Company admin'}
        </Badge>
      ),
    },
    {
      key: 'actions', header: '', align: 'right',
      render: (u) => (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="danger"
            className="w-8 px-0"
            loading={pendingId === u.id && removeUser.isPending}
            disabled={pendingId !== null}
            aria-label={`Remove ${u.fullName}`}
            title={`Remove ${u.fullName}`}
            onClick={() => remove(u.id, u.fullName)}
          >
            X
          </Button>
          <Button size="sm" variant="secondary" loading={pendingId === u.id && approval.isPending} disabled={pendingId !== null} onClick={() => decide(u.id, 'REJECT')}>
            Reject
          </Button>
          <Button size="sm" loading={pendingId === u.id && approval.isPending} disabled={pendingId !== null} onClick={() => decide(u.id, 'APPROVE')}>
            Approve
          </Button>
        </div>
      ),
    },
  ];

  // Approval history: a processed request is APPROVED when its user is ACTIVE, else REJECTED.
  const historyColumns: Column<UserProfile>[] = [
    { key: 'name', header: 'Name', render: (u) => <span className="font-medium text-text">{u.fullName}</span> },
    { key: 'email', header: 'Email', render: (u) => u.email },
    { key: 'company', header: 'Company', render: (u) => <Badge tone="neutral">{u.companyName}</Badge> },
    {
      key: 'role',
      header: 'Requested as',
      // Phase 7: the queue now mixes company-admin and security registrations, so the row must say
      // which — approving a gate operator is a different decision from granting company admin.
      render: (u) => (
        <Badge tone={u.role === 'SECURITY' ? 'accent' : 'primary'}>
          {u.role === 'SECURITY' ? 'Security' : 'Company admin'}
        </Badge>
      ),
    },
    {
      key: 'decision', header: 'Decision', align: 'right',
      render: (u) => (
        <Badge tone={u.status === 'ACTIVE' ? 'success' : 'danger'}>
          {u.status === 'ACTIVE' ? 'Approved' : 'Rejected'}
        </Badge>
      ),
    },
    {
      key: 'actions', header: '', align: 'right',
      render: (u) => (
        <Button
          size="sm"
          variant="danger"
          className="w-8 px-0"
          loading={pendingId === u.id && removeUser.isPending}
          disabled={pendingId !== null}
          aria-label={`Remove ${u.fullName}`}
          title={`Remove ${u.fullName}`}
          onClick={() => remove(u.id, u.fullName)}
        >
          X
        </Button>
      ),
    },
  ];

  const historyItems = history.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-4xl">Privileged registrations</h1>
        <p className="text-text-muted">
          People who registered as a company admin or as building security. Only you can action these.
        </p>
      </div>

      <Card title="Pending requests" padded={false}>
        {requests.isLoading ? (
          <LoadingState label="Loading requests…" />
        ) : requests.isError ? (
          <ErrorState title="Couldn't load requests" />
        ) : !requests.data || requests.data.items.length === 0 ? (
          <EmptyState title="No pending requests" description="New company-admin sign-ups will appear here." />
        ) : (
          <>
            <Table columns={columns} rows={requests.data.items} rowKey={(u) => u.id} />
            <Pager page={requests.data.meta.page} pageSize={requests.data.meta.pageSize} total={requests.data.meta.total} onPage={setPendingPage} />
          </>
        )}
      </Card>

      <Card title="Approval history" description="Requests you've already approved or rejected." padded={false}>
        {history.isLoading ? (
          <LoadingState label="Loading history…" />
        ) : history.isError ? (
          <ErrorState title="Couldn't load history" />
        ) : historyItems.length === 0 ? (
          <EmptyState title="No decisions yet" description="Approved and rejected requests will be listed here." />
        ) : (
          <>
            <Table columns={historyColumns} rows={historyItems} rowKey={(u) => u.id} />
            {history.data && (
              <Pager page={history.data.meta.page} pageSize={history.data.meta.pageSize} total={history.data.meta.total} onPage={setHistoryPage} />
            )}
          </>
        )}
      </Card>
    </div>
  );
}

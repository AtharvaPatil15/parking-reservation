import { useState } from 'react';
import {
  Badge, Button, Card, EmptyState, ErrorState, LoadingState, Table, useToast,
  type Column,
} from '../../components';
import { usePendingAdmins, useAdminRequestHistory, useApproveAdminRequest } from '../../api/hooks';
import type { components } from '../../api/types';

type UserProfile = components['schemas']['UserProfile'];

/**
 * Super Admin queue of pending company-admin registration requests (F11). Approving grants the
 * applicant the CompanyAdmin assignment for their (existing) company; rejecting marks them REJECTED.
 * Processed requests move to the persisted "Approval history" (GET /users/admin-requests/history),
 * so decisions stay visible after they leave the pending queue.
 */
export function AdminApprovals() {
  const requests = usePendingAdmins();
  const history = useAdminRequestHistory();
  const approval = useApproveAdminRequest();
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

  const columns: Column<UserProfile>[] = [
    { key: 'name', header: 'Name', render: (u) => <span className="font-medium text-text">{u.fullName}</span> },
    { key: 'email', header: 'Email', render: (u) => u.email },
    { key: 'company', header: 'Company', render: (u) => <Badge tone="neutral">{u.companyName}</Badge> },
    {
      key: 'actions', header: '', align: 'right',
      render: (u) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" loading={pendingId === u.id} disabled={pendingId !== null} onClick={() => decide(u.id, 'REJECT')}>
            Reject
          </Button>
          <Button size="sm" loading={pendingId === u.id} disabled={pendingId !== null} onClick={() => decide(u.id, 'APPROVE')}>
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
      key: 'decision', header: 'Decision', align: 'right',
      render: (u) => (
        <Badge tone={u.status === 'ACTIVE' ? 'success' : 'danger'}>
          {u.status === 'ACTIVE' ? 'Approved' : 'Rejected'}
        </Badge>
      ),
    },
  ];

  const historyItems = history.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Company-admin requests</h2>
        <p className="text-text-muted">People who registered as a company admin. Approving grants them admin of their company.</p>
      </div>

      <Card title="Pending requests" padded={false}>
        {requests.isLoading ? (
          <LoadingState label="Loading requests…" />
        ) : requests.isError ? (
          <ErrorState title="Couldn't load requests" />
        ) : !requests.data || requests.data.items.length === 0 ? (
          <EmptyState title="No pending requests" description="New company-admin sign-ups will appear here." />
        ) : (
          <Table columns={columns} rows={requests.data.items} rowKey={(u) => u.id} />
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
          <Table columns={historyColumns} rows={historyItems} rowKey={(u) => u.id} />
        )}
      </Card>
    </div>
  );
}

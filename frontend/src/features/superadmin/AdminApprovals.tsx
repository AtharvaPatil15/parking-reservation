import { useState } from 'react';
import {
  Badge, Button, Card, EmptyState, ErrorState, LoadingState, Table, useToast,
  type Column,
} from '../../components';
import { usePendingAdmins, useApproveAdminRequest } from '../../api/hooks';
import type { components } from '../../api/types';

type UserProfile = components['schemas']['UserProfile'];
type Decision = 'APPROVE' | 'REJECT';
type Processed = { user: UserProfile; decision: Decision };

/**
 * Super Admin queue of pending company-admin registration requests (F11). Approving grants the
 * applicant the CompanyAdmin assignment for their (existing) company; rejecting marks them REJECTED.
 * Once decided, a request leaves the pending queue — so we also keep a "Recently processed" log of
 * decisions made in this session, so the outcome isn't lost from view.
 */
export function AdminApprovals() {
  const requests = usePendingAdmins();
  const approval = useApproveAdminRequest();
  const { toast } = useToast();
  // Track the row currently mutating so only its buttons show a spinner.
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Session-local history of decisions (newest first). Persisted history across reloads
  // would need a backend endpoint listing processed admin requests — not in the contract.
  const [processed, setProcessed] = useState<Processed[]>([]);

  function decide(user: UserProfile, decision: Decision) {
    setPendingId(user.id);
    approval.mutate(
      { userId: user.id, decision },
      {
        onSuccess: () => {
          toast(decision === 'APPROVE' ? 'Company admin approved.' : 'Request rejected.', { tone: 'success' });
          setProcessed((prev) => [{ user, decision }, ...prev]);
        },
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
          <Button size="sm" variant="secondary" loading={pendingId === u.id} disabled={pendingId !== null} onClick={() => decide(u, 'REJECT')}>
            Reject
          </Button>
          <Button size="sm" loading={pendingId === u.id} disabled={pendingId !== null} onClick={() => decide(u, 'APPROVE')}>
            Approve
          </Button>
        </div>
      ),
    },
  ];

  const processedColumns: Column<Processed>[] = [
    { key: 'name', header: 'Name', render: (p) => <span className="font-medium text-text">{p.user.fullName}</span> },
    { key: 'email', header: 'Email', render: (p) => p.user.email },
    { key: 'company', header: 'Company', render: (p) => <Badge tone="neutral">{p.user.companyName}</Badge> },
    {
      key: 'decision', header: 'Decision', align: 'right',
      render: (p) => (
        <Badge tone={p.decision === 'APPROVE' ? 'success' : 'danger'}>
          {p.decision === 'APPROVE' ? 'Approved' : 'Rejected'}
        </Badge>
      ),
    },
  ];

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

      {processed.length > 0 && (
        <Card
          title="Recently processed"
          description="Decisions you've made this session (kept here so the outcome stays visible)."
          padded={false}
        >
          <Table columns={processedColumns} rows={processed} rowKey={(p) => `${p.user.id}-${p.decision}`} />
        </Card>
      )}
    </div>
  );
}

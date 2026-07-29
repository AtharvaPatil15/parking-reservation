import {
  Badge, Button, Card, EmptyState, ErrorState, LoadingState, Table, useToast,
  type BadgeTone, type Column,
} from '../../components';
import { useCompanyUsers, useSetUserApproval } from '../../api/hooks';
import { useAuth } from '../../lib/auth';
import type { components } from '../../api/types';

type UserProfile = components['schemas']['UserProfile'];

function statusTone(status: UserProfile['status']): BadgeTone {
  switch (status) {
    case 'ACTIVE': return 'success';
    case 'PENDING': return 'warning';
    case 'REJECTED': return 'danger';
    default: return 'neutral';
  }
}

export function Approvals() {
  const { user } = useAuth();
  const companyId = user?.companyId ?? undefined;
  const users = useCompanyUsers(companyId);
  const approval = useSetUserApproval(companyId);
  const { toast } = useToast();

  function decide(userId: string, decision: 'APPROVE' | 'REJECT') {
    approval.mutate(
      { userId, decision },
      { onSuccess: () => toast(decision === 'APPROVE' ? 'User approved.' : 'User rejected.', { tone: 'success' }) },
    );
  }

  const columns: Column<UserProfile>[] = [
    { key: 'name', header: 'Name', render: (u) => <span className="font-medium text-text">{u.fullName}</span> },
    { key: 'email', header: 'Email', render: (u) => u.email },
    { key: 'status', header: 'Status', render: (u) => <Badge tone={statusTone(u.status)}>{u.status}</Badge> },
    {
      key: 'actions', header: '', align: 'right',
      render: (u) =>
        u.status === 'PENDING' ? (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" loading={approval.isPending} onClick={() => decide(u.id, 'REJECT')}>
              Reject
            </Button>
            <Button size="sm" loading={approval.isPending} onClick={() => decide(u.id, 'APPROVE')}>
              Approve
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">User approvals</h2>
        <p className="text-text-muted">Approve or reject people who signed up for your company.</p>
      </div>

      <Card title="Members" padded={false}>
        {users.isLoading ? (
          <LoadingState label="Loading members…" />
        ) : users.isError ? (
          <ErrorState title="Couldn't load members" />
        ) : !users.data || users.data.items.length === 0 ? (
          <EmptyState title="No members yet" />
        ) : (
          <Table columns={columns} rows={users.data.items} rowKey={(u) => u.id} />
        )}
      </Card>
    </div>
  );
}

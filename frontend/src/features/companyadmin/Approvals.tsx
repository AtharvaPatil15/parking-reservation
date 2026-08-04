import { useState } from 'react';
import {
  Badge, Button, Card, EmptyState, ErrorState, LoadingState, Pager, Table, useToast,
  type BadgeTone, type Column,
} from '../../components';
import { useCompanyUsers, useRemoveCompanyUser, useSetUserApproval } from '../../api/hooks';
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
  const [page, setPage] = useState(1);
  const users = useCompanyUsers(companyId, page);
  const approval = useSetUserApproval(companyId);
  const removeUser = useRemoveCompanyUser(companyId);
  const { toast } = useToast();
  // Track the row currently mutating so only its buttons show a spinner.
  const [pendingId, setPendingId] = useState<string | null>(null);

  function decide(userId: string, decision: 'APPROVE' | 'REJECT') {
    setPendingId(userId);
    approval.mutate(
      { userId, decision },
      {
        onSuccess: () => toast(decision === 'APPROVE' ? 'User approved.' : 'User rejected.', { tone: 'success' }),
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
    { key: 'name', header: 'Name', stackedBare: true, render: (u) => <span className="font-medium text-text">{u.fullName}</span> },
    { key: 'email', header: 'Email', render: (u) => u.email },
    { key: 'status', header: 'Status', render: (u) => <Badge tone={statusTone(u.status)}>{u.status}</Badge> },
    {
      key: 'actions', header: '', align: 'right', stackedBare: true,
      render: (u) =>
        u.role === 'USER' ? (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="danger"
              loading={pendingId === u.id && removeUser.isPending}
              disabled={pendingId !== null}
              aria-label={`Remove ${u.fullName}`}
              title={`Remove ${u.fullName}`}
              onClick={() => remove(u.id, u.fullName)}
            >
              Remove
            </Button>
            {u.status === 'PENDING' && (
              <>
            <Button size="sm" variant="secondary" loading={pendingId === u.id && approval.isPending} disabled={pendingId !== null} onClick={() => decide(u.id, 'REJECT')}>
              Reject
            </Button>
            <Button size="sm" loading={pendingId === u.id && approval.isPending} disabled={pendingId !== null} onClick={() => decide(u.id, 'APPROVE')}>
              Approve
            </Button>
              </>
            )}
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-4xl">User approvals</h1>
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
          <>
            <Table columns={columns} rows={users.data.items} rowKey={(u) => u.id} />
            <Pager page={users.data.meta.page} pageSize={users.data.meta.pageSize} total={users.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

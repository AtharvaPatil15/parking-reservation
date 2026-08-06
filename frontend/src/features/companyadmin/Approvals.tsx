import { useState } from 'react';
import {
  Badge, Button, Card, EmptyState, ErrorState, LoadingState, Pager, Table, useToast,
  type BadgeTone, type Column,
} from '../../components';
import { useCompanyUsers, useRemoveCompanyUser, useSetUserApproval } from '../../api/hooks';
import { useAuth } from '../../lib/auth';
import { UserDetailsModal } from '../shared/UserDetailsModal';
import { VehicleRegistrations } from '../shared/VehicleRegistrations';
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
  const [detailId, setDetailId] = useState<string | null>(null);
  // Taken from the already-loaded page rather than the dialog's own fetch, so the footer buttons render
  // immediately instead of popping in a moment after the dialog opens.
  const detailUser = users.data?.items.find((u) => u.id === detailId);

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
    {
      key: 'name',
      header: 'Name',
      // The name is the affordance for the details dialog: an admin cannot judge an approval from a name
      // and an email, and the distance-from-home behind it is what the person's whole allocation score
      // is built on. A button rather than a row click, so removing/approving stays unambiguous.
      render: (u) => (
        <button
          type="button"
          onClick={() => setDetailId(u.id)}
          className="text-left font-medium text-text underline-offset-2 hover:underline"
        >
          {u.fullName}
        </button>
      ),
    },
    { key: 'email', header: 'Email', render: (u) => u.email },
    { key: 'status', header: 'Status', render: (u) => <Badge tone={statusTone(u.status)}>{u.status}</Badge> },
    {
      key: 'actions', header: '', align: 'right',
      render: (u) =>
        u.role === 'USER' ? (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDetailId(u.id)}>
              Details
            </Button>
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
        <h2 className="text-xl font-semibold tracking-tight">User approvals</h2>
        <p className="text-text-muted">Approve or reject people who signed up for your company.</p>
      </div>

      {/* Above the member list: somebody is standing at the barrier waiting on this one. */}
      <VehicleRegistrations />

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

      <UserDetailsModal
        userId={detailId}
        onClose={() => setDetailId(null)}
        actions={
          detailUser?.status === 'PENDING' ? (
            <>
              <Button
                variant="secondary"
                loading={pendingId === detailUser.id && approval.isPending}
                disabled={pendingId !== null}
                onClick={() => {
                  decide(detailUser.id, 'REJECT');
                  setDetailId(null);
                }}
              >
                Reject
              </Button>
              <Button
                loading={pendingId === detailUser.id && approval.isPending}
                disabled={pendingId !== null}
                onClick={() => {
                  decide(detailUser.id, 'APPROVE');
                  setDetailId(null);
                }}
              >
                Approve
              </Button>
            </>
          ) : null
        }
      />
    </div>
  );
}

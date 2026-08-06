import { useState } from 'react';
import {
  Badge, Button, Card, EmptyState, ErrorState, LoadingState, Pager, Table, useToast,
  type BadgeTone, type Column,
} from '../../components';
import { useDecideVehicleRegistration, useVehicleRegistrations } from '../../api/hooks';
import { ApiError } from '../../api/http';
import type { components } from '../../api/types';

type VehicleRegistration = components['schemas']['VehicleRegistration'];

function statusTone(status: VehicleRegistration['status']): BadgeTone {
  switch (status) {
    case 'APPROVED': return 'success';
    case 'PENDING': return 'warning';
    default: return 'danger';
  }
}

const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Walk-in cars security asked to have registered — the approval queue, shared by the company-admin and
 * super-admin screens because the decision and the data are identical for both. Scope is enforced
 * server-side: a Company Admin only ever receives their own company's rows.
 *
 * The urgency is worth stating in the copy: unlike every other approval in this app, somebody is standing
 * at the barrier while this one waits. Approving it is what puts the car in the registry and lets the
 * guard check it in.
 */
export function VehicleRegistrations({ showCompany = false }: { showCompany?: boolean }) {
  const [page, setPage] = useState(1);
  const registrations = useVehicleRegistrations({ page });
  const decide = useDecideVehicleRegistration();
  const { toast } = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);

  function act(r: VehicleRegistration, decision: 'APPROVE' | 'REJECT') {
    setPendingId(r.id);
    decide.mutate(
      { id: r.id, decision },
      {
        onSuccess: () =>
          toast(
            decision === 'APPROVE'
              ? `${r.displayNumber} added to the registry — security can let them in.`
              : `${r.displayNumber} rejected.`,
            { tone: decision === 'APPROVE' ? 'success' : 'info' },
          ),
        onError: (e) =>
          toast(e instanceof ApiError ? e.message : 'Could not update the request.', { tone: 'danger' }),
        onSettled: () => setPendingId(null),
      },
    );
  }

  const columns: Column<VehicleRegistration>[] = [
    {
      key: 'car',
      header: 'Car',
      render: (r) => (
        <div className="flex flex-col">
          <span className="font-medium text-text">{r.displayNumber}</span>
          <span className="text-xs text-text-muted">
            {[r.vehicleType.replace('_', ' ').toLowerCase(), r.makeModel, r.colour].filter(Boolean).join(' · ')}
          </span>
        </div>
      ),
    },
    {
      key: 'person',
      header: 'Person',
      render: (r) => (
        <div className="flex flex-col">
          <span className="text-text">{r.ownerName}</span>
          <span className="text-xs text-text-muted">
            {r.contactNumber ?? r.ownerEmail ?? 'No contact given'}
          </span>
        </div>
      ),
    },
    ...(showCompany
      ? [
          {
            key: 'company',
            header: 'Company',
            render: (r: VehicleRegistration) => <Badge tone="neutral">{r.companyName}</Badge>,
          } satisfies Column<VehicleRegistration>,
        ]
      : []),
    { key: 'requested', header: 'Asked at', render: (r) => when(r.createdAt) },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) =>
        r.status === 'PENDING' ? (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={pendingId === r.id && decide.isPending}
              disabled={pendingId !== null}
              onClick={() => act(r, 'REJECT')}
            >
              Reject
            </Button>
            <Button
              size="sm"
              loading={pendingId === r.id && decide.isPending}
              disabled={pendingId !== null}
              onClick={() => act(r, 'APPROVE')}
            >
              Approve
            </Button>
          </div>
        ) : null,
    },
  ];

  const items = registrations.data?.items ?? [];
  const pendingCount = items.filter((r) => r.status === 'PENDING').length;

  return (
    <Card
      title={pendingCount > 0 ? `Cars at the gate (${pendingCount} waiting)` : 'Cars at the gate'}
      description="Security registered these for people arriving without a car on file. The car stays outside until you approve it."
      padded={false}
    >
      {registrations.isLoading ? (
        <LoadingState label="Loading requests…" />
      ) : registrations.isError ? (
        <ErrorState title="Couldn't load requests" />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          description="When security registers a car at the barrier, it will appear here for approval."
        />
      ) : (
        <>
          <Table columns={columns} rows={items} rowKey={(r) => r.id} />
          {registrations.data && (
            <Pager
              page={registrations.data.meta.page}
              pageSize={registrations.data.meta.pageSize}
              total={registrations.data.meta.total}
              onPage={setPage}
            />
          )}
        </>
      )}
    </Card>
  );
}

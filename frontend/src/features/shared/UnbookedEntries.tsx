import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, Table, type Column } from '../../components';
import { useUnbookedEntries } from '../../api/hooks';
import type { components } from '../../api/types';

type GateEvent = components['schemas']['GateEvent'];

const timeOnly = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export interface UnbookedEntriesProps {
  /** SUPER_ADMIN only — narrow to one company. Ignored server-side for COMPANY_ADMIN. */
  companyId?: string;
  date?: string;
}

/**
 * "Entered without a booking" (Phase 7 D16) — the company admin's follow-up list.
 *
 * Security never turns anyone away at the barrier, so an unbooked entry has to surface *somewhere*:
 * this is that somewhere. The company admin can see who came in without a slot and act on it.
 */
export function UnbookedEntries({ companyId, date }: UnbookedEntriesProps) {
  const entries = useUnbookedEntries({ companyId, date, pageSize: 10 });
  const rows = entries.data?.items ?? [];

  const columns: Column<GateEvent>[] = [
    {
      key: 'car',
      header: 'Car',
      render: (e) => (
        <div className="flex flex-col">
          <span className="font-medium text-text">{e.displayNumber}</span>
          <span className="text-xs text-text-muted">{e.ownerName ?? 'Unregistered vehicle'}</span>
        </div>
      ),
    },
    { key: 'companyName', header: 'Company', render: (e) => e.companyName ?? '—' },
    { key: 'checkInAt', header: 'Entered', render: (e) => timeOnly(e.checkInAt) },
    { key: 'checkOutAt', header: 'Left', render: (e) => (e.checkOutAt ? timeOnly(e.checkOutAt) : '—') },
    {
      key: 'status',
      header: '',
      render: (e) =>
        e.status === 'CHECKED_IN' ? <Badge tone="warning">Still inside</Badge> : <Badge tone="neutral">Left</Badge>,
    },
  ];

  return (
    <Card
      title="Entered without a booking"
      description="Security recorded these vehicles today even though they had no parking slot."
    >
      {entries.isLoading ? (
        <LoadingState label="Loading gate entries…" />
      ) : entries.isError ? (
        <ErrorState
          description="Could not load gate entries."
          action={
            <Button variant="secondary" size="sm" onClick={() => entries.refetch()}>
              Retry
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing to follow up"
          description="Every vehicle recorded today had a booking."
        />
      ) : (
        <Table columns={columns} rows={rows} rowKey={(e) => e.id} />
      )}
    </Card>
  );
}

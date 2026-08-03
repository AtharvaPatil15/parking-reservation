import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Table,
  type Column,
} from '../../components';
import { useGateEvents } from '../../api/hooks';
import { useAuth } from '../../lib/auth';
import { GateDrawer, type GateMode } from './GateDrawer';
import type { components } from '../../api/types';

type GateEvent = components['schemas']['GateEvent'];

const timeOnly = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * The security screen (Phase 7 §5). Two actions and nothing else — that is the whole persona: a guard
 * at a barrier needs big targets and no decisions. Today's log sits underneath so they can see what
 * they have already recorded and who is still inside.
 */
export function GateConsole() {
  const { user } = useAuth();
  const [mode, setMode] = useState<GateMode | null>(null);
  const events = useGateEvents();

  const rows = events.data?.items ?? [];
  const inside = rows.filter((e) => e.status === 'CHECKED_IN').length;
  const unbooked = rows.filter((e) => !e.hadBooking).length;

  const columns: Column<GateEvent>[] = [
    {
      key: 'displayNumber',
      header: 'Car',
      render: (e) => (
        <div className="flex flex-col">
          <span className="font-medium text-text">{e.displayNumber}</span>
          <span className="text-xs text-text-muted">{e.ownerName ?? 'Unregistered vehicle'}</span>
        </div>
      ),
    },
    { key: 'companyName', header: 'Company', render: (e) => e.companyName ?? '—' },
    {
      key: 'hadBooking',
      header: 'Booking',
      render: (e) =>
        e.hadBooking ? <Badge tone="success">Booked</Badge> : <Badge tone="warning">No booking</Badge>,
    },
    { key: 'checkInAt', header: 'In', render: (e) => timeOnly(e.checkInAt) },
    { key: 'checkOutAt', header: 'Out', render: (e) => (e.checkOutAt ? timeOnly(e.checkOutAt) : '—') },
    {
      key: 'status',
      header: 'Status',
      render: (e) =>
        e.status === 'CHECKED_IN' ? <Badge tone="primary">Inside</Badge> : <Badge tone="neutral">Left</Badge>,
    },
  ];

  return (
    <div className="max-w-5xl space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Gate</h1>
        <p className="text-text-muted">
          {user?.fullName ? `${user.fullName} · ` : ''}Record vehicles entering and leaving.
        </p>
      </div>

      {/* Deliberately oversized: this is a tablet at a barrier, tapped one-handed. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Button className="h-24 text-base" onClick={() => setMode('CHECK_IN')}>
          Check in
        </Button>
        <Button variant="secondary" className="h-24 text-base" onClick={() => setMode('CHECK_OUT')}>
          Check out
        </Button>
      </div>

      <Card>
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium text-text">Today</h2>
            <p className="text-sm text-text-muted">
              {inside} inside · {rows.length} visit{rows.length === 1 ? '' : 's'}
              {unbooked > 0 && ` · ${unbooked} without a booking`}
            </p>
          </div>

          {events.isLoading ? (
            <LoadingState label="Loading today's gate log…" />
          ) : events.isError ? (
            <ErrorState
              description="Could not load the gate log."
              action={
                <Button variant="secondary" size="sm" onClick={() => events.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState title="Nothing recorded yet" description="Check a vehicle in to start today's log." />
          ) : (
            <Table columns={columns} rows={rows} rowKey={(e) => e.id} />
          )}
        </div>
      </Card>

      <GateDrawer mode={mode} onClose={() => setMode(null)} />
    </div>
  );
}

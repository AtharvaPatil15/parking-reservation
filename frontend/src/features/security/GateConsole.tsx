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
import { useGateEvents, useVehicleRegistrations } from '../../api/hooks';
import { useAuth } from '../../lib/auth';
import { GateDrawer, type GateMode } from './GateDrawer';
import { GateCapacity } from './GateCapacity';
import { RegisterVehicleDrawer } from './RegisterVehicleDrawer';
import type { components } from '../../api/types';

type GateEvent = components['schemas']['GateEvent'];
type VehicleRegistration = components['schemas']['VehicleRegistration'];

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
  // `null` = closed. A string (possibly empty) = open, pre-filled with the plate already typed.
  const [registerFor, setRegisterFor] = useState<string | null>(null);
  const events = useGateEvents();
  // Only the guard's own submissions come back here (scoped server-side), which is exactly the list they
  // need: each pending row is a car sitting at the barrier waiting on somebody's approval.
  const registrations = useVehicleRegistrations({ pageSize: 5 });

  const rows = events.data?.items ?? [];
  const inside = rows.filter((e) => e.status === 'CHECKED_IN').length;
  const unbooked = rows.filter((e) => !e.hadBooking).length;

  const myRegistrations: VehicleRegistration[] = registrations.data?.items ?? [];
  const pendingRegistrations = myRegistrations.filter((r) => r.status === 'PENDING');
  // Only recent approvals are worth surfacing: this panel exists to tell the guard "the car outside can
  // come in now", and once it is inside the row is just noise.
  const approvedRegistrations = myRegistrations.filter(
    (r) => r.status === 'APPROVED' && !rows.some((e) => e.vehicleNumber === r.vehicleNumber),
  );

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
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-4xl">Gate</h1>
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

      {/* Third action. Still visibly secondary to the two above — registering a car is the exception, not
          a default — but a tablet at a barrier is tapped one-handed, and a ghost link was too small a
          target for something a guard reaches for with a driver waiting. */}
      <Button variant="secondary" className="h-16 w-full text-base" onClick={() => setRegisterFor('')}>
        Register a new car
      </Button>

      <GateCapacity />

      {pendingRegistrations.length > 0 && (
        <Card
          title={`Waiting for approval (${pendingRegistrations.length})`}
          description="These cars stay outside until the company approves them. Call the company if it is taking too long."
        >
          <ul className="divide-y divide-border text-sm">
            {pendingRegistrations.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-medium text-text">
                  {r.displayNumber} <span className="font-normal text-text-muted">· {r.ownerName}</span>
                </span>
                <span className="text-text-muted">{r.companyName}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {approvedRegistrations.length > 0 && (
        <Card
          title="Approved — you can let these in"
          description="Registered and approved. Check them in as normal."
        >
          <ul className="divide-y divide-border text-sm">
            {approvedRegistrations.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-medium text-text">
                  {r.displayNumber} <span className="font-normal text-text-muted">· {r.ownerName}</span>
                </span>
                <Badge tone="success">Approved</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

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

      <GateDrawer
        mode={mode}
        onClose={() => setMode(null)}
        onRegister={(plate) => {
          setMode(null);
          setRegisterFor(plate);
        }}
      />
      <RegisterVehicleDrawer
        open={registerFor !== null}
        initialNumber={registerFor ?? ''}
        onClose={() => setRegisterFor(null)}
      />
    </div>
  );
}

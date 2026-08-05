import { Badge, Button, Card, ErrorState, LoadingState, Table, type Column } from '../../components';
import { useGateCapacity } from '../../api/hooks';
import type { components } from '../../api/types';

type CapacityRow = components['schemas']['GateCapacityRow'];

const num = (n: number) => <span className="tabular-nums">{n}</span>;

/**
 * Per-company capacity, on the gate's landing page.
 *
 * The guard's question is not "how is utilisation trending", it is "can this car come in". So `Free` is
 * the emphasised column and it is quota-relative — `slots − blocked − given a slot` — NOT
 * `slots − inside`. An allocated slot whose owner has not arrived yet is taken; admitting a car into it
 * would be handing away somebody's reservation.
 *
 * `Inside` sits beside it to answer the follow-up: 10 given a slot and 7 inside means 3 are still
 * expected. And since a walk-in registration now waits for an admin, `Free` is what tells the guard
 * whether phoning that admin is even worth it.
 */
export function GateCapacity() {
  const capacity = useGateCapacity();

  const columns: Column<CapacityRow>[] = [
    {
      key: 'companyName',
      header: 'Company',
      render: (r) => <span className="font-medium text-text">{r.companyName}</span>,
    },
    { key: 'slots', header: 'Slots', align: 'right', render: (r) => num(r.slots) },
    {
      key: 'blocked',
      header: 'Blocked',
      align: 'right',
      // Shown even when zero: without it `slots − allocated ≠ free` and the panel reads as broken.
      render: (r) => <span className="tabular-nums text-text-muted">{r.blocked}</span>,
    },
    { key: 'requests', header: 'Booked today', align: 'right', render: (r) => num(r.requests) },
    { key: 'allocated', header: 'Given a slot', align: 'right', render: (r) => num(r.allocated) },
    {
      key: 'free',
      header: 'Free',
      align: 'right',
      render: (r) =>
        r.free > 0 ? (
          <Badge tone="success">{r.free}</Badge>
        ) : (
          <Badge tone="neutral">Full</Badge>
        ),
    },
    { key: 'inside', header: 'Inside', align: 'right', render: (r) => num(r.inside) },
  ];

  if (capacity.isLoading) return <LoadingState label="Loading capacity…" />;
  if (capacity.isError || !capacity.data) {
    return (
      <ErrorState
        title="Couldn't load capacity"
        description="The gate log below still works."
        action={
          <Button variant="secondary" size="sm" onClick={() => capacity.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const { rows, building } = capacity.data;

  return (
    <Card
      title="Slots today"
      description="What each company holds, and what is still free. Free counts slots nobody has been given — not slots that happen to be empty right now."
      padded={false}
    >
      <Table columns={columns} rows={rows} rowKey={(r) => r.companyId} empty="No active companies." />
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-border px-4 py-3 text-sm sm:px-6">
        <span className="font-medium text-text">Building</span>
        <span className="text-text-muted">
          {/* Physical slots first: "how big is this car park" is a different question from "how much has
              been allotted", and under-allotment makes the two differ. */}
          <span className="tabular-nums">{building.totalSlots}</span> slots ·{' '}
          <span className="tabular-nums">{building.allottedSlots}</span> allotted ·{' '}
          <span className="tabular-nums">{building.allocated}</span> given out ·{' '}
          <span className="font-medium text-text tabular-nums">{building.free}</span> free ·{' '}
          <span className="tabular-nums">{building.inside}</span> inside
          {building.insideUnattributed > 0 && (
            <>
              {' '}
              (<span className="tabular-nums">{building.insideUnattributed}</span> unregistered)
            </>
          )}
        </span>
      </div>
    </Card>
  );
}

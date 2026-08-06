import { Badge, Button, Card, ErrorState, LoadingState, Table, type Column } from '../../components';
import { useGateCapacity } from '../../api/hooks';
import type { components } from '../../api/types';

type CapacityRow = components['schemas']['GateCapacityRow'];

/**
 * Per-company slots today, on the gate's landing page.
 *
 * Two numbers per company and nothing else, because they are the only two a guard acts on and because
 * they always sum to that company's slots for the day. The endpoint returns more — quota, blocked,
 * requests, allocated, inside — and showing all of it made the panel look wrong: six numbers that only
 * reconcile once you know that blocked slots are excluded from free and that a reserved slot counts as
 * taken before its owner arrives. A guard should not have to derive that at a barrier.
 *
 * `Remaining` is quota-relative — `slots − blocked − given a slot`, NOT `slots − cars inside`. An
 * allocated slot whose owner has not arrived yet is taken; admitting a walk-in into it would be handing
 * away somebody's reservation. So `Filled` necessarily counts blocked and reserved slots alongside
 * occupied ones; the hover breakdown says which is which, and how many cars are physically in the
 * building is answered by the gate log directly below.
 */
export function GateCapacity() {
  const capacity = useGateCapacity();

  const columns: Column<CapacityRow>[] = [
    {
      key: 'companyName',
      header: 'Company',
      render: (r) => <span className="font-medium text-text">{r.companyName}</span>,
    },
    {
      key: 'filled',
      header: 'Slots filled',
      align: 'right',
      // Derived rather than read: `slots - free` is blocked + reserved by construction, so filled and
      // remaining always add up to the company's slots. Summing fields could drift from `free` if the
      // server ever changed how it computes it.
      render: (r) => (
        <span
          className="tabular-nums"
          title={`${r.allocated} given a slot${r.blocked ? ` · ${r.blocked} blocked` : ''} · of ${r.slots} slots`}
        >
          {r.slots - r.free}
        </span>
      ),
    },
    {
      key: 'free',
      header: 'Slots remaining',
      align: 'right',
      render: (r) =>
        r.free > 0 ? <Badge tone="success">{r.free}</Badge> : <Badge tone="neutral">Full</Badge>,
    },
  ];

  if (capacity.isLoading) return <LoadingState label="Loading slots…" />;
  if (capacity.isError || !capacity.data) {
    return (
      <ErrorState
        title="Couldn't load slots"
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
  // The building line totals the companies, so it must sum what the rows show — `allottedSlots`, the
  // slots actually handed to a company. Physical slots that no company holds are not a guard's to give.
  const buildingFilled = building.allottedSlots - building.free;

  return (
    <Card
      title="Slots today"
      description="What is taken and what is left, per company. A slot someone has been given counts as taken even before they arrive."
      padded={false}
    >
      <Table columns={columns} rows={rows} rowKey={(r) => r.companyId} empty="No active companies." />
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-border px-4 py-3 text-sm sm:px-6">
        <span className="font-medium text-text">Building</span>
        <span className="text-text-muted">
          <span className="tabular-nums">{buildingFilled}</span> filled ·{' '}
          <span className="font-medium text-text tabular-nums">{building.free}</span> remaining
        </span>
      </div>
    </Card>
  );
}

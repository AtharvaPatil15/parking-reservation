import { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, Table, type Column } from '../../components';
import {
  useAllocationBreakdown,
  useRunPrimaryAllocation,
  useRunCommonPoolAllocation,
} from '../../api/hooks';
import { nextBookableWeekday } from '../../lib/dates';
import { ApiError } from '../../api/http';
import type { components } from '../../api/types';

type AllocationResultRow = components['schemas']['AllocationResultRow'];

const columns: Column<AllocationResultRow>[] = [
  { key: 'rank', header: 'Rank', render: (r) => <span className={r.rank === 1 ? 'font-semibold text-accent' : ''}>{r.rank}</span> },
  { key: 'user', header: 'User', render: (r) => r.user ?? r.userId ?? '—' },
  { key: 'distance', header: 'Distance', align: 'right', className: 'tabular-nums', render: (r) => (r.distanceKm != null ? `${r.distanceKm} km` : '—') },
  { key: 'people', header: 'People', align: 'right', className: 'tabular-nums', render: (r) => r.people },
  { key: 'distanceScore', header: 'Distance score', align: 'right', className: 'tabular-nums', render: (r) => r.distanceScore.toFixed(1) },
  { key: 'carpoolScore', header: 'Carpool score', align: 'right', className: 'tabular-nums', render: (r) => r.carpoolScore.toFixed(1) },
  { key: 'finalScore', header: 'Final', align: 'right', className: 'font-medium tabular-nums', render: (r) => r.finalScore.toFixed(1) },
  { key: 'outcome', header: 'Outcome', render: (r) => <Badge tone={r.outcome === 'ALLOCATED' ? 'success' : 'warning'}>{r.outcome}</Badge> },
  { key: 'slot', header: 'Slot', render: (r) => r.slotNumber ?? '—' },
];

/** Ranked results table for a run id (shared by the primary + common-pool sections). */
function RunResults({ runId, emptyHint }: { runId: string | null; emptyHint: string }) {
  const breakdown = useAllocationBreakdown(runId ?? undefined);
  if (!runId) return null;
  return (
    <Card title="Results" description="Ranked by final score; the winning row is highlighted." padded={false}>
      {breakdown.isLoading ? (
        <LoadingState label="Loading results…" />
      ) : breakdown.isError ? (
        <ErrorState title="Couldn't load results" />
      ) : !breakdown.data || breakdown.data.results.length === 0 ? (
        <EmptyState title="No results" description={emptyHint} />
      ) : (
        <Table
          columns={columns}
          rows={breakdown.data.results}
          rowKey={(r) => r.bookingId ?? String(r.rank)}
          rowClassName={(r) => (r.rank === 1 ? 'bg-accent-subtle' : undefined)}
        />
      )}
    </Card>
  );
}

const runErrorText = (isError: boolean, error: unknown, fallback: string): string | null =>
  isError ? (error instanceof ApiError ? error.message : fallback) : null;

export function AllocationRun() {
  const [bookingDate, setBookingDate] = useState(nextBookableWeekday());
  const [primaryRunId, setPrimaryRunId] = useState<string | null>(null);
  const [commonPoolRunId, setCommonPoolRunId] = useState<string | null>(null);

  const primary = useRunPrimaryAllocation();
  const commonPool = useRunCommonPoolAllocation();

  function onRunPrimary() {
    primary.mutate({ bookingDate }, { onSuccess: (summary) => setPrimaryRunId(summary.id) });
  }
  function onRunCommonPool() {
    commonPool.mutate({ bookingDate }, { onSuccess: (summary) => setCommonPoolRunId(summary.id) });
  }

  const primaryError = runErrorText(primary.isError, primary.error, 'Could not start the allocation run.');
  const commonPoolError = runErrorText(commonPool.isError, commonPool.error, 'Could not start the common-pool run.');

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Allocation</h2>
        <p className="text-text-muted">
          Run the scoring engine for a booking date, then open the common pool to redistribute unused slots.
        </p>
      </div>

      <Card>
        <div className="w-48">
          <Input label="Booking date" type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} />
        </div>
      </Card>

      {/* Step 1 — primary allocation */}
      <Card title="1 · Primary allocation" description="Rank each company's submitted requests and assign within its quota.">
        <Button onClick={onRunPrimary} loading={primary.isPending} disabled={!bookingDate}>
          Run primary allocation
        </Button>
        {primaryError && (
          <p role="alert" className="mt-3 rounded-control border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">
            {primaryError}
          </p>
        )}
      </Card>
      <RunResults runId={primaryRunId} emptyHint="No requests were scored for this date." />

      {/* Step 2 — common pool */}
      <Card
        title="2 · Common pool"
        description="Enroll the users waitlisted by primary and share every company's unused slots across the whole building, top score first."
      >
        <Button variant="secondary" onClick={onRunCommonPool} loading={commonPool.isPending} disabled={!bookingDate}>
          Start common pool
        </Button>
        {commonPoolError && (
          <p role="alert" className="mt-3 rounded-control border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">
            {commonPoolError}
          </p>
        )}
      </Card>
      <RunResults runId={commonPoolRunId} emptyHint="No waitlisted users or no spare slots for this date." />
    </div>
  );
}

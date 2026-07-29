import { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, Table, type Column } from '../../components';
import { useAllocationBreakdown, useRunPrimaryAllocation } from '../../api/hooks';
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

export function AllocationRun() {
  const [bookingDate, setBookingDate] = useState(nextBookableWeekday());
  const [runId, setRunId] = useState<string | null>(null);
  const run = useRunPrimaryAllocation();
  const breakdown = useAllocationBreakdown(runId ?? undefined);

  function onRun() {
    run.mutate({ bookingDate }, { onSuccess: (summary) => setRunId(summary.id) });
  }

  const runError = run.isError
    ? run.error instanceof ApiError
      ? run.error.message
      : 'Could not start the allocation run.'
    : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Primary allocation</h2>
        <p className="text-text-muted">Run the scoring engine for a booking date and review the ranked results.</p>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-48">
            <Input
              label="Booking date"
              type="date"
              value={bookingDate}
              onChange={(e) => setBookingDate(e.target.value)}
            />
          </div>
          <Button onClick={onRun} loading={run.isPending} disabled={!bookingDate}>
            Run primary allocation
          </Button>
        </div>
        {runError && (
          <p role="alert" className="mt-3 rounded-control border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">
            {runError}
          </p>
        )}
      </Card>

      {runId && (
        <Card title="Allocation results" description="Ranked by final score; the winning row is highlighted." padded={false}>
          {breakdown.isLoading ? (
            <LoadingState label="Loading results…" />
          ) : breakdown.isError ? (
            <ErrorState title="Couldn't load results" />
          ) : !breakdown.data || breakdown.data.results.length === 0 ? (
            <EmptyState title="No results" description="No requests were scored for this date." />
          ) : (
            <Table
              columns={columns}
              rows={breakdown.data.results}
              rowKey={(r) => r.bookingId ?? String(r.rank)}
              rowClassName={(r) => (r.rank === 1 ? 'bg-accent-subtle' : undefined)}
            />
          )}
        </Card>
      )}
    </div>
  );
}

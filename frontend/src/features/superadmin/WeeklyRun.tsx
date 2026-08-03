import { Badge, Button, Card, ErrorState, LoadingState, Table, useToast, type Column } from '../../components';
import { useRunWeeklyAllocation, useWeeklyRunPreview } from '../../api/hooks';
import { ApiError } from '../../api/http';
import type { components } from '../../api/types';

type PreviewDate = components['schemas']['WeeklyRunPreview']['dates'][number];

const dayLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

const runLabel = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * The weekly weekend batch (Phase 7 D10) — the Super Admin's one button for scoring a whole band of
 * dates at once, replacing the per-date primary run as the normal path.
 *
 * There is no date field on purpose: the band comes from config, so the run cannot be pointed at the
 * wrong week. Running it before the scheduled day is allowed (useful for a demo) and simply decides
 * the upcoming band early.
 */
export function WeeklyRun() {
  const preview = useWeeklyRunPreview();
  const run = useRunWeeklyAllocation();
  const { toast } = useToast();

  if (preview.isLoading) return <LoadingState label="Loading the allocation band…" />;
  if (preview.isError || !preview.data) {
    return (
      <ErrorState
        title="Couldn't load the allocation band"
        action={
          <Button variant="secondary" size="sm" onClick={() => preview.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const { window: win, band, dates } = preview.data;
  const pendingTotal = dates.reduce((sum, d) => sum + d.pendingRequests, 0);
  const allDecided = dates.length > 0 && dates.every((d) => d.runStatus === 'COMPLETED');
  const result = run.data;

  const columns: Column<PreviewDate>[] = [
    { key: 'bookingDate', header: 'Date', render: (d) => dayLabel(d.bookingDate) },
    {
      key: 'pendingRequests',
      header: 'Awaiting allocation',
      align: 'right',
      render: (d) => <span className="tabular-nums">{d.pendingRequests}</span>,
    },
    {
      key: 'runStatus',
      header: 'Run',
      render: (d) =>
        d.runStatus === 'COMPLETED' ? (
          <Badge tone="success">Decided</Badge>
        ) : d.runStatus === 'FAILED' ? (
          <Badge tone="danger">Failed</Badge>
        ) : d.runStatus ? (
          <Badge tone="warning">{d.runStatus}</Badge>
        ) : (
          <Badge tone="neutral">Not run</Badge>
        ),
    },
  ];

  function onRun() {
    run.mutate(undefined, {
      onSuccess: (r) =>
        toast(
          `Allocated ${r.totalAllocated} slot(s) across ${r.dates.length} date(s)` +
            (r.totalWaitlisted > 0 ? `, ${r.totalWaitlisted} waitlisted.` : '.'),
          { tone: 'success' },
        ),
      onError: (e) =>
        toast(e instanceof ApiError ? e.message : 'Could not run the weekly allocation.', { tone: 'danger' }),
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Weekly allocation</h2>
        <p className="text-text-muted">
          Runs every {win.runDay.toLowerCase()} at {win.runTime} IST. Next: {runLabel(win.nextRunAt)}.
        </p>
      </div>

      <Card
        title={`Band: ${dayLabel(band.from)} – ${dayLabel(band.dates.at(-1) ?? band.from)}`}
        description={`These are the dates the next run decides. Every one is settled at least ${win.approvalLeadDays} days before itself, so nobody learns too late to make other arrangements.`}
      >
        <div className="space-y-4">
          <Table
            columns={columns}
            rows={dates}
            rowKey={(d) => d.bookingDate}
            empty="No dates in the current band."
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={onRun} loading={run.isPending} disabled={allDecided}>
              {allDecided ? 'Band already decided' : `Run allocation for ${dates.length} date(s)`}
            </Button>
            <p className="text-sm text-text-muted">
              {pendingTotal} request{pendingTotal === 1 ? '' : 's'} awaiting a decision.
            </p>
          </div>
        </div>
      </Card>

      {result && (
        <Card title="Last run" description={`Band ${result.band.from} → ${result.band.toExclusive} (exclusive).`}>
          <div className="space-y-3">
            <p className="text-sm text-text">
              {result.totalAllocated} allocated · {result.totalWaitlisted} waitlisted
            </p>
            <ul className="divide-y divide-border text-sm">
              {result.dates.map((d) => (
                <li key={d.bookingDate} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-medium text-text">{dayLabel(d.bookingDate)}</span>
                  <span className="text-text-muted">
                    {d.alreadyDecided
                      ? 'already decided — left untouched'
                      : `${d.allocated} allocated, ${d.waitlisted} waitlisted`}
                    {d.error ? ` · ${d.error}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}
    </div>
  );
}

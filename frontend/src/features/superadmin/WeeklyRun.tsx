import { Badge, Button, Card, ErrorState, LoadingState, Table, useToast, type Column } from '../../components';
import {
  useRunWeeklyAllocation,
  useRunWeeklyCommonPoolAllocation,
  useWeeklyRunPreview,
} from '../../api/hooks';
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

/** Shared by both run columns — the same four states mean the same thing for either run type. */
function RunBadge({ status }: { status: PreviewDate['runStatus'] }) {
  if (status === 'COMPLETED') return <Badge tone="success">Decided</Badge>;
  if (status === 'FAILED') return <Badge tone="danger">Failed</Badge>;
  if (status) return <Badge tone="warning">{status}</Badge>;
  return <Badge tone="neutral">Not run</Badge>;
}

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
  const commonPool = useRunWeeklyCommonPoolAllocation();
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

  // Common pool is a second, separate step over the same band. It has nothing to do until primary has
  // produced a waitlist, so gate the button on that rather than letting the operator run a no-op.
  const waitlistedTotal = dates.reduce((sum, d) => sum + d.waitlistedRequests, 0);
  const poolAllDone = dates.length > 0 && dates.every((d) => d.commonPoolStatus === 'COMPLETED');
  const poolResult = commonPool.data;

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
      header: 'Primary run',
      render: (d) => <RunBadge status={d.runStatus} />,
    },
    // Waitlisted-after-primary is the pool's input, so it belongs next to the pool's own status.
    {
      key: 'waitlistedRequests',
      header: 'Waitlisted',
      align: 'right',
      render: (d) => <span className="tabular-nums">{d.waitlistedRequests}</span>,
    },
    {
      key: 'commonPoolStatus',
      header: 'Common pool',
      render: (d) => <RunBadge status={d.commonPoolStatus} />,
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

  function onRunCommonPool() {
    commonPool.mutate(undefined, {
      onSuccess: (r) =>
        toast(
          r.totalAllocated > 0
            ? `Common pool placed ${r.totalAllocated} waitlisted request(s)` +
                (r.totalWaitlisted > 0 ? `, ${r.totalWaitlisted} still waitlisted.` : '.')
            : 'Common pool ran, but there were no spare slots to redistribute.',
          { tone: r.totalAllocated > 0 ? 'success' : 'info' },
        ),
      onError: (e) =>
        toast(e instanceof ApiError ? e.message : 'Could not run the common pool.', { tone: 'danger' }),
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-4xl">Weekly allocation</h1>
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

      {/* Step 2 — the same band, redistributed. Deliberately a separate action rather than chained
          onto step 1: the operator can see what primary waitlisted before deciding to share out the
          leftovers. The scheduler runs both back-to-back, so an untouched band still ends up complete. */}
      <Card
        title="Common pool"
        description="Shares every company's unused slots across the whole building, offering them to the users primary waitlisted — highest score first, regardless of company. Run this after the allocation above."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={onRunCommonPool}
            loading={commonPool.isPending}
            disabled={poolAllDone || waitlistedTotal === 0}
          >
            {poolAllDone ? 'Common pool already run' : `Run common pool for ${dates.length} date(s)`}
          </Button>
          <p className="text-sm text-text-muted">
            {poolAllDone
              ? 'Every date in this band has been through the pool.'
              : waitlistedTotal === 0
                ? 'Nothing waitlisted in this band — the pool has nobody to place.'
                : `${waitlistedTotal} waitlisted request${waitlistedTotal === 1 ? '' : 's'} could be placed.`}
          </p>
        </div>
      </Card>

      {poolResult && (
        <Card
          title="Last common-pool run"
          description={`Band ${poolResult.band.from} → ${poolResult.band.toExclusive} (exclusive).`}
        >
          <div className="space-y-3">
            <p className="text-sm text-text">
              {poolResult.totalAllocated} placed from the pool · {poolResult.totalWaitlisted} still waitlisted
            </p>
            <ul className="divide-y divide-border text-sm">
              {poolResult.dates.map((d) => (
                <li key={d.bookingDate} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-medium text-text">{dayLabel(d.bookingDate)}</span>
                  <span className="text-text-muted">
                    {d.alreadyDecided
                      ? 'already pooled — left untouched'
                      : `${d.allocated} placed, ${d.waitlisted} still waitlisted`}
                    {d.error ? ` · ${d.error}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

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

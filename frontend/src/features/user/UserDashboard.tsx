import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, SlotGrid } from '../../components';
import { useAvailability, useUserDashboard } from '../../api/hooks';
import { useCountdown } from '../../lib/useCountdown';
import { formatCountdown, todayIstIso } from '../../lib/dates';
import type { components } from '../../api/types';

type DayAvailability = components['schemas']['DayAvailability'];

const dayLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * Row status badge (P8-13): what the caller's own request for this date currently reads as. `null`
 * (no request) renders nothing — the row exists to show the grid, not to nag about an unbooked date.
 */
function rowStatus(day: DayAvailability): { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' } | null {
  if (day.myStatus === 'SUBMITTED') return { label: 'Queued', tone: 'neutral' };
  if (day.myStatus === 'ALLOCATED') return { label: `You got slot ${day.mySlotNumber ?? '—'}`, tone: 'success' };
  if (day.myStatus === 'WAITLISTED') return { label: 'Waitlisted', tone: 'warning' };
  if (day.reason === 'NO_QUOTA' || day.blocked >= day.quota) return { label: 'Blocked', tone: 'danger' };
  return null;
}

function formatRun(value: string) {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

/** Today's date as the kicker above the heading, in the app's IST timezone. */
function formatToday() {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Kolkata',
  }).format(new Date());
}

export function UserDashboard() {
  const dash = useUserDashboard();
  // One GET over the whole open window — no dedicated results endpoint (P8-13). Each row renders its
  // own OPEN/DECIDED phase straight from the same payload the booking form uses.
  //
  // `from: today` matters, and is not the same as omitting it. With no range the server starts at the
  // *earliest requestable* date (next run + approvalLeadDays), which sits in the future — so the dates
  // the last run just decided fall below the range and the panel silently loses every ALLOCATED /
  // WAITLISTED row the day after a run. This panel is precisely where those rows have to appear, so it
  // asks from today and lets the server keep its default upper bound.
  const availability = useAvailability({ from: todayIstIso() });
  const secondsLeft = useCountdown(dash.data?.cutoffCountdownSeconds);

  if (dash.isLoading) return <LoadingState label="Loading your dashboard…" />;
  if (dash.isError || !dash.data) return <ErrorState title="Couldn't load your dashboard" />;

  const d = dash.data;
  const upcoming = d.upcomingBooking;
  const weekDays = (availability.data?.days ?? []).filter((day) => day.reason !== 'NOT_WEEKDAY');
  // Prefer the full schedule when the payload carries it, else the single next run.
  const runs = d.nextAllocationRuns?.length
    ? d.nextAllocationRuns
    : d.nextAllocationRunAt
      ? [d.nextAllocationRunAt]
      : [];

  // The allocated slot is the one thing this screen exists to tell you, so it
  // carries the page as a solid plate rather than sitting in a thin card.
  const slot = upcoming?.allocatedSlotNumber;
  const heroStats: { k: string; v: string }[] = upcoming
    ? [
        { k: 'Status', v: upcoming.status },
        ...(upcoming.allocationScore != null ? [{ k: 'Score', v: upcoming.allocationScore.toFixed(1) }] : []),
        { k: 'Carpool', v: String(upcoming.carpoolMemberCount) },
        ...(upcoming.travelDistanceKm != null ? [{ k: 'Distance', v: `${upcoming.travelDistanceKm} km` }] : []),
      ]
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-3xs uppercase tracking-[0.16em] text-primary">
            {formatToday()}
          </p>
          <h1 className="mt-1 text-4xl">Your dashboard</h1>
        </div>
        <div className="flex flex-none gap-2">
          {upcoming && (
            <Link to={`/booking/${upcoming.id}`}>
              <Button variant="secondary">View status &amp; score</Button>
            </Link>
          )}
          {/* Always "Book a slot" — the app's existing wording, and the one name
              the booking CTA is reachable by on this screen. */}
          <Link to="/book">
            <Button>Book a slot</Button>
          </Link>
        </div>
      </div>

      {upcoming ? (
        <div className="flex flex-wrap items-end justify-between gap-8 bg-field px-8 py-8 text-field-ink shadow-dialog sm:px-11">
          <div className="min-w-0">
            <p className="font-mono text-3xs uppercase tracking-[0.19em] text-field-ink-3">
              {slot ? 'Your slot' : 'Requested'}
            </p>
            {/* The figure is the focal object: oversized, condensed, tight-tracked. */}
            <p className="mt-2 font-heading text-[86px] leading-[0.86] tracking-[-0.03em] sm:text-[112px]">
              {slot ?? '—'}
            </p>
            <p className="mt-3 text-sm text-field-ink-2">
              {upcoming.bookingDate}
              {secondsLeft != null &&
                ` · ${secondsLeft <= 0 ? 'booking window closed' : `cutoff in ${formatCountdown(secondsLeft)}`}`}
            </p>
          </div>
          <dl className="flex flex-none gap-9 pb-1.5">
            {heroStats.map((s) => (
              <div key={s.k}>
                <dt className="font-mono text-3xs uppercase tracking-[0.16em] text-field-ink-3">{s.k}</dt>
                <dd className="mt-1.5 font-heading text-2xl leading-none">{s.v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <Card>
          <EmptyState
            title="No upcoming booking"
            description="Reserve a parking slot for the next bookable weekday."
            action={
              <Link to="/book">
                <Button>Book a slot</Button>
              </Link>
            }
          />
        </Card>
      )}

      {/* Your week (P8-13): one row per date in the open window. Rows before their run day render the
          OPEN phase (a count, never a fullness gate — D18); decided rows show the real allocation. */}
      {availability.isLoading ? (
        <Card title="Your week">
          <p className="text-sm text-text-muted">Loading this week's requests…</p>
        </Card>
      ) : availability.isError ? (
        <Card title="Your week">
          <p className="text-sm text-danger">Couldn't load this week's requests.</p>
        </Card>
      ) : weekDays.length > 0 ? (
        <Card title="Your week" padded={false}>
          <ul className="divide-y divide-border">
            {weekDays.map((day) => {
              const status = rowStatus(day);
              return (
                <li key={day.date} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-[8rem] flex-col gap-1">
                    <span className="text-sm font-medium text-text">{dayLabel(day.date)}</span>
                    {status && (
                      <span className="flex items-center gap-2">
                        <Badge tone={status.tone}>{status.label}</Badge>
                        {/* Waitlisted is the one outcome with a "why?" — link through to the score
                            breakdown (via history, since this panel has no per-date booking id). */}
                        {day.myStatus === 'WAITLISTED' && (
                          <Link to="/my-bookings" className="text-xs text-primary hover:underline">
                            Why?
                          </Link>
                        )}
                      </span>
                    )}
                  </div>
                  <SlotGrid boxes={day.boxes} phase={day.phase} size="sm" />
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {/* When results publish. Kept alongside "Your week" because the week rows say
          what happened, not when the next decision lands. */}
      {runs.length > 0 && (
        <Card title="Next allocation run" meta={`${d.previousBookingsCount ?? 0} past`}>
          <ol className="flex flex-col">
            {runs.map((iso, i) => (
              <li
                key={iso}
                className="flex items-baseline justify-between gap-4 border-b border-border/50 py-2 last:border-b-0"
              >
                <span className="font-mono text-3xs uppercase tracking-[0.14em] text-primary">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="flex-1 text-sm tabular-nums">{formatRun(iso)} IST</span>
                {i === 0 && d.nextAllocationRunCountdownSeconds != null && (
                  <span className="flex-none text-xs tabular-nums text-text-muted">
                    in {formatCountdown(Math.max(0, d.nextAllocationRunCountdownSeconds))}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <p className="text-sm text-text-muted">
        {d.previousBookingsCount} past booking{d.previousBookingsCount === 1 ? '' : 's'} ·{' '}
        <Link to="/my-bookings" className="text-primary hover:underline">
          View history
        </Link>
      </p>
    </div>
  );
}

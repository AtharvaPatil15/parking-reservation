import { Link } from 'react-router-dom';
import { Badge, Card, EmptyState, ErrorState, LoadingState, SlotCount, buttonClasses } from '../../components';
import { useAvailability, useUserDashboard } from '../../api/hooks';
import { useCountdown } from '../../lib/useCountdown';
import { formatCountdown, formatLongCountdown, todayIstIso } from '../../lib/dates';
import { statusTone } from './statusTone';
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
  // The run countdown must tick like the cutoff above; rendering the payload value directly
  // left it frozen at whatever the last fetch returned.
  const runSecondsLeft = useCountdown(dash.data?.nextAllocationRunCountdownSeconds);

  if (dash.isLoading) return <LoadingState label="Loading your dashboard…" />;
  if (dash.isError || !dash.data) return <ErrorState title="Couldn't load your dashboard" />;

  const d = dash.data;
  const upcoming = d.upcomingBooking;
  const weekDays = (availability.data?.days ?? []).filter((day) => day.reason !== 'NOT_WEEKDAY');

  return (
    <div className="space-y-6">
      <h1 className="text-4xl">Your dashboard</h1>

      {upcoming ? (
        <Card title="Upcoming booking">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-text">{upcoming.bookingDate}</span>
              <Badge tone={statusTone(upcoming.status)}>{upcoming.status}</Badge>
            </div>
            {secondsLeft != null && (
              <p className="text-sm text-text-muted">
                {secondsLeft <= 0 ? 'Booking window closed.' : `Cutoff in ${formatCountdown(secondsLeft)}`}
              </p>
            )}
            <Link to={`/booking/${upcoming.id}`} className="text-primary hover:underline">
              View status &amp; score
            </Link>
          </div>
        </Card>
      ) : (
        <EmptyState
          title="No upcoming booking"
          description="Reserve a parking slot for the next bookable weekday."
          action={
            <Link to="/book" className="text-primary hover:underline">
              Book a slot
            </Link>
          }
        />
      )}

      {d.nextAllocationRunAt && (
        <Card title="Next allocation run">
          <div className="space-y-2">
            <p className="text-text">{formatRun(d.nextAllocationRunAt)} IST</p>
            {runSecondsLeft != null && (
              <p className="text-sm text-text-muted">
                {runSecondsLeft <= 0 ? 'Running now…' : `Runs in ${formatLongCountdown(runSecondsLeft)}`}
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Your week (P8-13): one row per date in the open window, each reporting how many of the
          company's slots are filled and empty. Rows before their run day read 0 filled — a request is a
          queue entry, never a reservation (D18) — and decided rows report the real allocation. */}
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
                  <SlotCount boxes={day.boxes} size="sm" />
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <Link to="/book" className={buttonClasses()}>
          Book a slot
        </Link>
        <p className="text-sm text-text-muted">
          {d.previousBookingsCount} past booking{d.previousBookingsCount === 1 ? '' : 's'} ·{' '}
          <Link to="/my-bookings" className="text-primary hover:underline">
            View history
          </Link>
        </p>
      </div>
    </div>
  );
}

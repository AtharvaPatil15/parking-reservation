import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorState, LoadingState } from '../../components';
import { useUserDashboard } from '../../api/hooks';
import { useCountdown } from '../../lib/useCountdown';
import { formatCountdown } from '../../lib/dates';

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
  const secondsLeft = useCountdown(dash.data?.cutoffCountdownSeconds);

  if (dash.isLoading) return <LoadingState label="Loading your dashboard…" />;
  if (dash.isError || !dash.data) return <ErrorState title="Couldn't load your dashboard" />;

  const d = dash.data;
  const upcoming = d.upcomingBooking;
  // Prefer the full schedule when the payload carries it, else the single next run.
  const runs = d.nextAllocationRuns?.length
    ? d.nextAllocationRuns
    : d.nextAllocationRunAt
      ? [d.nextAllocationRunAt]
      : [];

  // The allocated slot is the one thing this screen exists to tell you, so it
  // carries the page as a solid plate rather than sitting in a thin card.
  const slot = upcoming?.allocatedSlotNumber;
  const heroStats = upcoming
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

      {/* The runs list is a short label-and-date pair, so it takes a fixed column
          rather than stretching its rows across a wide monitor. */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,520px)_352px]">
        <Card title="Next allocation runs" meta={`${d.previousBookingsCount ?? 0} past`}>
          {runs.length === 0 ? (
            <p className="text-sm text-text-muted">No run is scheduled yet.</p>
          ) : (
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
          )}
        </Card>

        <Card title="Your bookings">
          <div className="space-y-3">
            <p className="font-heading text-3xl tabular-nums">{d.previousBookingsCount ?? 0}</p>
            <p className="text-sm text-text-muted">
              past booking{d.previousBookingsCount === 1 ? '' : 's'} on record.
            </p>
            <Link to="/my-bookings" className="inline-block text-sm text-primary hover:underline">
              View history →
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

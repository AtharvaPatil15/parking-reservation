import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '../../components';
import { useUserDashboard } from '../../api/hooks';
import { useCountdown } from '../../lib/useCountdown';
import { formatCountdown } from '../../lib/dates';
import { statusTone } from './statusTone';

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
  const secondsLeft = useCountdown(dash.data?.cutoffCountdownSeconds);

  if (dash.isLoading) return <LoadingState label="Loading your dashboard…" />;
  if (dash.isError || !dash.data) return <ErrorState title="Couldn't load your dashboard" />;

  const d = dash.data;
  const upcoming = d.upcomingBooking;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Your dashboard</h1>

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
            {d.nextAllocationRunCountdownSeconds != null && (
              <p className="text-sm text-text-muted">
                Runs in {formatCountdown(Math.max(0, d.nextAllocationRunCountdownSeconds))}
              </p>
            )}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Link to="/book">
          <Button>Book a slot</Button>
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

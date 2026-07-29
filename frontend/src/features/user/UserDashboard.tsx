import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '../../components';
import { useUserDashboard } from '../../api/hooks';
import { formatCountdown } from './bookingSchema';
import { statusTone } from './statusTone';

export function UserDashboard() {
  const dash = useUserDashboard();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    const initial = dash.data?.cutoffCountdownSeconds;
    if (initial == null) return;
    setSecondsLeft(initial);
    const t = setInterval(() => setSecondsLeft((s) => (s == null ? s : Math.max(0, s - 1))), 1000);
    return () => clearInterval(t);
  }, [dash.data?.cutoffCountdownSeconds]);

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
            <Link to={`/app/booking/${upcoming.id}`} className="text-primary hover:underline">
              View status &amp; score
            </Link>
          </div>
        </Card>
      ) : (
        <EmptyState
          title="No upcoming booking"
          description="Reserve a parking slot for the next bookable weekday."
          action={
            <Link to="/app/book" className="text-primary hover:underline">
              Book a slot
            </Link>
          }
        />
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Link to="/app/book">
          <Button>Book a slot</Button>
        </Link>
        <p className="text-sm text-text-muted">
          {d.previousBookingsCount} past booking{d.previousBookingsCount === 1 ? '' : 's'} ·{' '}
          <Link to="/app/history" className="text-primary hover:underline">
            View history
          </Link>
        </p>
      </div>
    </div>
  );
}

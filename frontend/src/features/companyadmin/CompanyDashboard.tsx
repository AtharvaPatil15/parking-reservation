import { ErrorState, LoadingState } from '../../components';
import { useCompanyAdminDashboard } from '../../api/hooks';
import { StatTiles, type Stat } from '../shared/StatTiles';
import { BookingList } from '../shared/BookingList';

const fmt = (n: number | undefined) => (n == null ? '—' : n.toLocaleString());
const pct = (n: number | undefined) => (n == null ? '—' : `${n}%`);

export function CompanyDashboard() {
  const dash = useCompanyAdminDashboard();

  if (dash.isLoading) return <LoadingState label="Loading dashboard…" />;
  if (dash.isError || !dash.data) return <ErrorState title="Couldn't load the dashboard" />;

  const d = dash.data;
  const stats: Stat[] = [
    { label: 'Company slots', value: fmt(d.totalCompanySlots) },
    { label: 'Available', value: fmt(d.availableCompanySlots) },
    { label: 'Booked', value: fmt(d.bookedSlots) },
    { label: 'Blocked', value: fmt(d.blockedSlots) },
    { label: 'Booking requests', value: fmt(d.totalBookingRequests) },
    { label: 'Allocated users', value: fmt(d.allocatedUsers) },
    { label: 'Waitlisted users', value: fmt(d.waitlistedUsers) },
    { label: 'Daily utilization', value: pct(d.dailyUtilizationPct) },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
        <p className="text-text-muted">Today's parking utilization for your company.</p>
      </div>
      <StatTiles stats={stats} />
      <BookingList scope="company" />
    </div>
  );
}

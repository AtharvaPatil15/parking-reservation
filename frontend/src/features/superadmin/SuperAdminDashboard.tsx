import { ErrorState, LoadingState } from '../../components';
import { useSuperAdminDashboard } from '../../api/hooks';
import { StatTiles, type Stat } from '../shared/StatTiles';

const fmt = (n: number | undefined) => (n == null ? '—' : n.toLocaleString());
const pct = (n: number | undefined) => (n == null ? '—' : `${n}%`);

export function SuperAdminDashboard() {
  const dash = useSuperAdminDashboard();

  if (dash.isLoading) return <LoadingState label="Loading dashboard…" />;
  if (dash.isError || !dash.data) return <ErrorState title="Couldn't load the dashboard" />;

  const d = dash.data;
  const stats: Stat[] = [
    { label: 'Parking slots', value: fmt(d.totalParkingSlots) },
    { label: 'Active companies', value: fmt(d.totalActiveCompanies) },
    { label: 'Available slots', value: fmt(d.availableSlots) },
    { label: 'Blocked slots', value: fmt(d.blockedSlots) },
    { label: 'Primary bookings', value: fmt(d.primaryBookings) },
    { label: 'Common-pool bookings', value: fmt(d.commonPoolBookings) },
    { label: 'Waitlisted', value: fmt(d.waitlistCount) },
    { label: 'Daily utilization', value: pct(d.dailyUtilizationPct) },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
        <p className="text-text-muted">Today's parking utilization across all companies.</p>
      </div>
      <StatTiles stats={stats} />
    </div>
  );
}

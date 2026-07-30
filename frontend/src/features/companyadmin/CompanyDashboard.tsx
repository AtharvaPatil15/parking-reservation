import { useState } from 'react';
import { ErrorState, Input, LoadingState } from '../../components';
import { useCompanyAdminDashboard } from '../../api/hooks';
import { StatTiles, type Stat } from '../shared/StatTiles';
import { BookingList } from '../shared/BookingList';

const fmt = (n: number | undefined) => (n == null ? '—' : n.toLocaleString());
const pct = (n: number | undefined) => (n == null ? '—' : `${n}%`);

export function CompanyDashboard() {
  const [date, setDate] = useState('');
  const dash = useCompanyAdminDashboard(date || undefined);

  const d = dash.data;
  const stats: Stat[] = d
    ? [
        { label: 'Company slots', value: fmt(d.totalCompanySlots) },
        { label: 'Available', value: fmt(d.availableCompanySlots) },
        { label: 'Booked', value: fmt(d.bookedSlots) },
        { label: 'Blocked', value: fmt(d.blockedSlots) },
        { label: 'Booking requests', value: fmt(d.totalBookingRequests) },
        { label: 'Allocated users', value: fmt(d.allocatedUsers) },
        { label: 'Waitlisted users', value: fmt(d.waitlistedUsers) },
        { label: 'Daily utilization', value: pct(d.dailyUtilizationPct) },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
          <p className="text-text-muted">
            Parking utilization {date ? `on ${date}` : 'today'} for your company.
          </p>
        </div>
        <div className="w-44">
          <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} hint="Blank = today" />
        </div>
      </div>

      {dash.isLoading ? (
        <LoadingState label="Loading dashboard…" />
      ) : dash.isError || !d ? (
        <ErrorState title="Couldn't load the dashboard" />
      ) : (
        <StatTiles stats={stats} />
      )}

      <BookingList scope="company" date={date} />
    </div>
  );
}

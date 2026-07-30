import { useState } from 'react';
import { ErrorState, Input, LoadingState } from '../../components';
import { useSuperAdminDashboard } from '../../api/hooks';
import { StatTiles, type Stat } from '../shared/StatTiles';
import { BookingList } from '../shared/BookingList';

const fmt = (n: number | undefined) => (n == null ? '—' : n.toLocaleString());
const pct = (n: number | undefined) => (n == null ? '—' : `${n}%`);

export function SuperAdminDashboard() {
  const [date, setDate] = useState('');
  const dash = useSuperAdminDashboard(date || undefined);

  const d = dash.data;
  const stats: Stat[] = d
    ? [
        { label: 'Parking slots', value: fmt(d.totalParkingSlots) },
        { label: 'Active companies', value: fmt(d.totalActiveCompanies) },
        { label: 'Available slots', value: fmt(d.availableSlots) },
        { label: 'Blocked slots', value: fmt(d.blockedSlots) },
        { label: 'Primary bookings', value: fmt(d.primaryBookings) },
        { label: 'Common-pool bookings', value: fmt(d.commonPoolBookings) },
        { label: 'Waitlisted', value: fmt(d.waitlistCount) },
        { label: 'Daily utilization', value: pct(d.dailyUtilizationPct) },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
          <p className="text-text-muted">
            Parking utilization {date ? `on ${date}` : 'today'} across all companies.
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

      <BookingList scope="all" date={date} />
    </div>
  );
}

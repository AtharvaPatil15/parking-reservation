import { useState } from 'react';
import { ErrorState, Input, LoadingState } from '../../components';
import { useSuperAdminDashboard } from '../../api/hooks';
import { StatTiles, type Stat } from '../shared/StatTiles';
import { SlotSplit } from '../shared/SlotSplit';
import { BookingList } from '../shared/BookingList';

const fmt = (n: number | undefined) => (n == null ? '—' : n.toLocaleString());
const pct = (n: number | undefined) => (n == null ? '—' : `${n}%`);

export function SuperAdminDashboard() {
  const [date, setDate] = useState('');
  const dash = useSuperAdminDashboard(date || undefined);

  const d = dash.data;
  // Notes are derived from figures the payload already carries — nothing invented.
  const stats: Stat[] = d
    ? [
        { label: 'Parking slots', value: fmt(d.totalParkingSlots) },
        { label: 'Active companies', value: fmt(d.totalActiveCompanies) },
        { label: 'Available slots', value: fmt(d.availableSlots), hint: 'bookable right now' },
        { label: 'Blocked slots', value: fmt(d.blockedSlots) },
        { label: 'Primary bookings', value: fmt(d.primaryBookings), hint: 'before the cutoff' },
        { label: 'Common-pool bookings', value: fmt(d.commonPoolBookings), hint: 'after the primary run' },
        { label: 'Waitlisted', value: fmt(d.waitlistCount), hint: 'promote as slots free up' },
        { label: 'Daily utilization', value: pct(d.dailyUtilizationPct) },
      ]
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-3xs uppercase tracking-[0.16em] text-primary">Utilization</p>
          <h1 className="mt-1 text-4xl">Overview</h1>
          <p className="mt-1 max-w-[62ch] text-text-muted">
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
        <>
          <StatTiles stats={stats} />
          {/* The split sits above rather than beside the table: this list carries
              seven columns (company, date and score included), which a half-width
              column would wrap into an unreadable mess. */}
          <SlotSplit
            className="lg:max-w-[560px]"
            total={d.totalParkingSlots}
            booked={d.primaryBookings}
            pool={d.commonPoolBookings}
            blocked={d.blockedSlots}
            free={d.availableSlots}
          />
          <BookingList scope="all" date={date} />
        </>
      )}
    </div>
  );
}

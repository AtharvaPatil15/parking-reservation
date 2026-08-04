import { useState } from 'react';
import { Button, ErrorState, Input, LoadingState } from '../../components';
import { useCompanyAdminDashboard } from '../../api/hooks';
import { apiErrorText } from '../../api/http';
import { StatTiles, type Stat } from '../shared/StatTiles';
import { SlotSplit } from '../shared/SlotSplit';
import { BookingList } from '../shared/BookingList';
import { UnbookedEntries } from '../shared/UnbookedEntries';

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
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-3xs uppercase tracking-[0.16em] text-primary">Company utilization</p>
          <h2 className="mt-1 text-4xl">Overview</h2>
          <p className="mt-1 max-w-[62ch] text-text-muted">
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
        <ErrorState
          title="Couldn't load the dashboard"
          description={apiErrorText(dash.error) ?? 'Please check that the backend is running, then try again.'}
          action={
            <Button variant="secondary" size="sm" onClick={() => dash.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <>
          <StatTiles stats={stats} />
          <div className="grid items-start gap-5 lg:grid-cols-[396px_minmax(0,1fr)]">
            <SlotSplit
              total={d.totalCompanySlots}
              booked={d.bookedSlots}
              blocked={d.blockedSlots}
              free={d.availableCompanySlots}
            />
            {/* Phase 7 D16: security never blocks the barrier, so unbooked entries land here. */}
            <UnbookedEntries date={date || undefined} />
          </div>
        </>
      )}

      <BookingList scope="company" date={date} />
    </div>
  );
}

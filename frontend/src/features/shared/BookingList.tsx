import { useState } from 'react';
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, Select, Table,
  type BadgeTone, type Column, type SelectOption,
} from '../../components';
import { useAdminBookings, useActiveCompanies } from '../../api/hooks';
import type { components } from '../../api/types';

type AdminBooking = components['schemas']['AdminBooking'];
type BookingStatus = components['schemas']['BookingStatus'];

const STATUS_TONE: Record<BookingStatus, BadgeTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'primary',
  ALLOCATED: 'success',
  WAITLISTED: 'warning',
  RELEASED: 'accent',
  CANCELLED: 'neutral',
  REJECTED: 'danger',
  EXPIRED: 'neutral',
};

const PAGE_SIZE = 20;

/**
 * Booking roster for the admin dashboards — who booked, for what date, its status and slot.
 * `scope='company'` (Company Admin) is server-scoped to the caller's company; `scope='all'`
 * (Super Admin) shows every company and adds a company filter + column.
 */
export function BookingList({ scope }: { scope: 'company' | 'all' }) {
  const showCompany = scope === 'all';
  const [date, setDate] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [page, setPage] = useState(1);

  const companies = useActiveCompanies();
  const bookings = useAdminBookings({
    date: date || undefined,
    companyId: showCompany ? companyId || undefined : undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const companyOptions: SelectOption[] = [
    { value: '', label: 'All companies' },
    ...(companies.data ?? []).map((c) => ({ value: c.id, label: c.name })),
  ];

  const columns: Column<AdminBooking>[] = [
    ...(showCompany
      ? [{ key: 'company', header: 'Company', render: (b: AdminBooking) => b.companyName }]
      : []),
    { key: 'employee', header: 'Employee', render: (b) => (
      <div>
        <div className="font-medium">{b.employeeName}</div>
        <div className="text-xs text-text-muted">{b.employeeEmail}</div>
      </div>
    ) },
    { key: 'date', header: 'Date', className: 'tabular-nums', render: (b) => b.bookingDate },
    { key: 'type', header: 'Type', render: (b) => <Badge tone="neutral">{b.bookingType}</Badge> },
    { key: 'status', header: 'Status', render: (b) => <Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge> },
    { key: 'slot', header: 'Slot', align: 'right', className: 'tabular-nums', render: (b) => b.allocatedSlotNumber ?? '—' },
  ];

  const meta = bookings.data?.meta;
  const total = meta?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Reset to page 1 whenever a filter changes (avoids landing on an out-of-range page).
  function onDate(v: string) { setDate(v); setPage(1); }
  function onCompany(v: string) { setCompanyId(v); setPage(1); }

  return (
    <Card title="Bookings" padded={false}>
      <div className="flex flex-wrap items-end gap-3 px-6 pt-5">
        <div className="w-44">
          <Input label="Date" type="date" value={date} onChange={(e) => onDate(e.target.value)} hint="Blank = all dates" />
        </div>
        {showCompany && (
          <div className="w-52">
            <Select label="Company" options={companyOptions} value={companyId} onChange={(e) => onCompany(e.target.value)} />
          </div>
        )}
        {(date || companyId) && (
          <Button variant="secondary" size="sm" onClick={() => { setDate(''); setCompanyId(''); setPage(1); }}>
            Clear
          </Button>
        )}
      </div>

      {bookings.isLoading ? (
        <LoadingState label="Loading bookings…" />
      ) : bookings.isError ? (
        <ErrorState title="Couldn't load bookings" />
      ) : !bookings.data || bookings.data.items.length === 0 ? (
        <EmptyState title="No bookings" description={date ? `No bookings for ${date}.` : 'No bookings yet.'} />
      ) : (
        <>
          <Table columns={columns} rows={bookings.data.items} rowKey={(b) => b.id} className="mt-4" />
          <div className="flex items-center justify-between px-6 py-3 text-sm text-text-muted">
            <span>{total} booking{total === 1 ? '' : 's'}</span>
            {lastPage > 1 && (
              <div className="flex items-center gap-3">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
                <span className="tabular-nums">Page {page} / {lastPage}</span>
                <Button variant="secondary" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

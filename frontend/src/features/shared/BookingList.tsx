import { useEffect, useState } from 'react';
import {
  Badge, Button, Card, EmptyState, ErrorState, LoadingState, Select, Table,
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

function displayType(row: AdminBooking) {
  return row.status === 'ALLOCATED' && row.allocationSource ? row.allocationSource : row.bookingType;
}

function displayTypeLabel(row: AdminBooking) {
  return displayType(row).replace('_', ' ');
}

/**
 * Booking roster for the admin dashboards - who booked, for what date, its status and slot.
 * `scope='company'` (Company Admin) is server-scoped to the caller's company; `scope='all'`
 * (Super Admin) shows every company and adds a company filter + column. `date` is controlled by
 * the dashboard's date picker (blank = all dates).
 */
export function BookingList({ scope, date = '' }: { scope: 'company' | 'all'; date?: string }) {
  const showCompany = scope === 'all';
  const [companyId, setCompanyId] = useState('');
  const [page, setPage] = useState(1);
  const [openBookingId, setOpenBookingId] = useState<string | null>(null);

  // The date is driven by the dashboard-level picker; reset paging when it changes.
  useEffect(() => setPage(1), [date]);

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

  const rows = bookings.data?.items ?? [];

  function detailLine(label: string, value: string | number | null | undefined) {
    return (
      <div>
        <dt className="text-xs uppercase text-text-muted">{label}</dt>
        <dd className="mt-0.5 font-medium">{value ?? '-'}</dd>
      </div>
    );
  }

  const columns: Column<AdminBooking>[] = [
    ...(showCompany
      ? [{ key: 'company', header: 'Company', stackedBare: true, render: (b: AdminBooking) => b.companyName }]
      : []),
    { key: 'employee', header: 'Employee', stackedBare: true, render: (b) => (
      <div>
        <div className="font-medium">{b.employeeName}</div>
        <div className="text-xs text-text-muted">{b.employeeEmail}</div>
        {b.history && b.history.length > 1 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {b.history.map((h) => (
              <span key={h.id} className="bg-surface-2 px-1.5 py-0.5 text-xs text-text-muted">
                {displayTypeLabel(h)} {h.status}
              </span>
            ))}
          </div>
        )}
      </div>
    ) },
    { key: 'date', header: 'Date', className: 'tabular-nums', render: (b) => b.bookingDate },
    { key: 'type', header: 'Type', render: (b) => <Badge tone="neutral">{displayTypeLabel(b)}</Badge> },
    { key: 'status', header: 'Status', render: (b) => <Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge> },
    // Show the allocation score for every request, not only allocated ones, so admins can see
    // how waitlisted/unallocated bookings scored ('-' before scoring runs).
    { key: 'score', header: 'Score', align: 'right', className: 'tabular-nums', render: (b) => (b.allocationScore != null ? b.allocationScore.toFixed(1) : '-') },
    { key: 'slot', header: 'Slot', align: 'right', className: 'tabular-nums', render: (b) => b.allocatedSlotNumber ?? '-' },
    {
      key: 'details',
      header: '',
      align: 'right',
      render: (b) => {
        const isOpen = openBookingId === b.id;
        const members = b.carpoolMembers ?? [];
        return (
          <div className="flex flex-col items-end">
            <Button variant="secondary" size="sm" onClick={() => setOpenBookingId(isOpen ? null : b.id)}>
              {isOpen ? 'Hide' : 'Details'}
            </Button>
            {/* max-w, not a fixed width: this sits in a table cell inside a
                horizontally-scrolling wrapper, so a hard 28rem widened the table
                and pushed the panel off-screen on a phone. */}
            {isOpen && (
              <div className="mt-2 w-full max-w-[28rem] rounded-card border border-border bg-surface p-4 text-left shadow-pop">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {detailLine('People carried', b.carpoolPeople)}
                  {detailLine('Passengers', Math.max(0, b.carpoolPeople - 1))}
                  {detailLine('Distance', b.travelDistanceKm != null ? `${b.travelDistanceKm} km` : null)}
                  {detailLine('Vehicle slot', b.allocatedSlotNumber)}
                  {detailLine('Submitted', b.submittedAt ? new Date(b.submittedAt).toLocaleString() : null)}
                  {detailLine('Created', new Date(b.createdAt).toLocaleString())}
                </dl>
                <div className="mt-4 border-t border-border pt-3">
                  <p className="text-xs font-medium uppercase text-text-muted">Passenger details</p>
                  {members.length === 0 ? (
                    <p className="mt-2 text-sm text-text-muted">Driver only.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {members.map((m) => (
                        <div key={m.id} className="rounded-control bg-surface-2 px-3 py-2 text-sm">
                          <div className="font-medium">{m.name}</div>
                          <div className="text-xs text-text-muted">{m.employeeEmail ?? 'No email'}</div>
                          {(m.contactNumber || m.pickupLocation) && (
                            <div className="mt-1 space-y-0.5 text-xs text-text-muted">
                              <div>Contact: {m.contactNumber ?? '-'}</div>
                              <div>Pickup: {m.pickupLocation ?? '-'}</div>
                            </div>
                          )}
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge tone={m.sameCompany ? 'success' : 'neutral'}>{m.sameCompany ? 'Same company' : 'Not matched'}</Badge>
                            <Badge tone={m.isScored ? 'primary' : 'neutral'}>{m.isScored ? 'Scored' : 'Not scored'}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      },
    },
  ];

  const total = bookings.data?.meta.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Reset to page 1 whenever a filter changes (avoids landing on an out-of-range page).
  function onCompany(v: string) { setCompanyId(v); setPage(1); }

  return (
    <Card title="Bookings" padded={false}>
      {showCompany && (
        <div className="flex flex-wrap items-end gap-3 px-6 pt-5">
          <div className="w-52">
            <Select label="Company" options={companyOptions} value={companyId} onChange={(e) => onCompany(e.target.value)} />
          </div>
          {companyId && (
            <Button variant="secondary" size="sm" onClick={() => { setCompanyId(''); setPage(1); }}>
              Clear
            </Button>
          )}
        </div>
      )}

      {bookings.isLoading ? (
        <LoadingState label="Loading bookings..." />
      ) : bookings.isError ? (
        <ErrorState title="Couldn't load bookings" />
      ) : !bookings.data || rows.length === 0 ? (
        <EmptyState title="No bookings" description={date ? `No bookings for ${date}.` : 'No bookings yet.'} />
      ) : (
        <>
          <Table columns={columns} rows={rows} rowKey={(b) => b.id} className="mt-4" />
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

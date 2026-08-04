import { useEffect, useState, type ReactNode } from 'react';
import {
  Badge, Button, Card, EmptyState, ErrorState, LoadingState, Modal, Pager, Select, Table,
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

type DetailLine = (label: string, value: string | number | null | undefined) => ReactNode;

const dateTime = (v: string | null | undefined) => (v ? new Date(v).toLocaleString() : null);

/**
 * Everything the API knows about one booking, for the admin details popup: the driver's own
 * request, then a row per declared passenger.
 *
 * `sameCompany` and `isScored` are reported separately because they answer different questions -
 * whether the passenger resolved to a colleague, and whether they counted toward the carpool score.
 */
function BookingDetails({
  booking: b,
  showCompany,
  detailLine,
}: {
  booking: AdminBooking;
  showCompany: boolean;
  detailLine: DetailLine;
}) {
  const members = b.carpoolMembers ?? [];
  return (
    <div className="text-left">
      {/* One column on a phone, widening with the viewport — 3 across is unreadable at 360px. */}
      <dl className="grid grid-cols-1 gap-3 text-sm min-[420px]:grid-cols-2 sm:grid-cols-3">
        {detailLine('Employee', b.employeeName)}
        {detailLine('Email', b.employeeEmail)}
        {showCompany && detailLine('Company', b.companyName)}
        {detailLine('Booking date', b.bookingDate)}
        {detailLine('Status', b.status)}
        {detailLine('Type', displayTypeLabel(b))}
        {detailLine('People carried', b.carpoolPeople)}
        {detailLine('Passengers', Math.max(0, b.carpoolPeople - 1))}
        {detailLine('Distance', b.travelDistanceKm != null ? `${b.travelDistanceKm} km` : null)}
        {detailLine('Score', b.allocationScore != null ? b.allocationScore.toFixed(1) : null)}
        {detailLine('Vehicle slot', b.allocatedSlotNumber)}
        {detailLine('Submitted', dateTime(b.submittedAt))}
        {detailLine('Created', dateTime(b.createdAt))}
      </dl>

      <div className="mt-5 border-t border-border pt-4">
        <p className="text-xs font-medium uppercase text-text-muted">
          Passenger details {members.length > 0 && `(${members.length})`}
        </p>
        {members.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">Driver only — no passengers declared.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {members.map((m) => (
              <div key={m.id} className="rounded-control bg-surface-2 px-3 py-2 text-sm">
                <div className="font-medium">{m.name}</div>
                <div className="text-xs text-text-muted">{m.employeeEmail || 'No email provided'}</div>
                {/* Always shown: an absent contact/pickup is itself information for the admin. */}
                <div className="mt-1 space-y-0.5 text-xs text-text-muted">
                  <div>Contact: {m.contactNumber || '-'}</div>
                  <div>Pickup: {m.pickupLocation || '-'}</div>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <Badge tone={m.sameCompany ? 'success' : 'neutral'}>
                    {m.sameCompany ? 'Same company' : 'Not matched'}
                  </Badge>
                  <Badge tone={m.isScored ? 'primary' : 'neutral'}>
                    {m.isScored ? 'Scored' : 'Not scored'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {b.history && b.history.length > 1 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-xs font-medium uppercase text-text-muted">Lifecycle</p>
          <ul className="mt-2 space-y-1 text-sm">
            {b.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={STATUS_TONE[h.status]}>{h.status}</Badge>
                <span className="text-text-muted">{displayTypeLabel(h)}</span>
                <span className="text-xs text-text-muted">{dateTime(h.submittedAt ?? h.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
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

  // Close the details popup when the visible rows change under it, so it can't outlive its row.
  useEffect(() => setOpenBookingId(null), [page, date, companyId]);

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

  // Blank strings count as missing too, so a cleared field reads '-' rather than an empty row.
  function detailLine(label: string, value: string | number | null | undefined) {
    const shown = value === null || value === undefined || value === '' ? '-' : value;
    return (
      <div>
        <dt className="text-xs uppercase text-text-muted">{label}</dt>
        <dd className="mt-0.5 font-medium">{shown}</dd>
      </div>
    );
  }

  const columns: Column<AdminBooking>[] = [
    ...(showCompany
      ? [{ key: 'company', header: 'Company', render: (b: AdminBooking) => b.companyName }]
      : []),
    { key: 'employee', header: 'Employee', render: (b) => (
      <div>
        <div className="font-medium">{b.employeeName}</div>
        <div className="text-xs text-text-muted">{b.employeeEmail}</div>
        {b.history && b.history.length > 1 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {b.history.map((h) => (
              <span key={h.id} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-muted">
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
      // The panel itself is rendered once, outside the table, as a modal. A fixed-width block
      // inside a horizontally-scrolling cell could never lay out correctly.
      render: (b) => (
        <Button variant="secondary" size="sm" onClick={() => setOpenBookingId(b.id)}>
          Details
        </Button>
      ),
    },
  ];

  const total = bookings.data?.meta.total ?? 0;

  // Reset to page 1 whenever a filter changes (avoids landing on an out-of-range page).
  function onCompany(v: string) { setCompanyId(v); setPage(1); }

  const openBooking = rows.find((b) => b.id === openBookingId) ?? null;

  return (
    <Card title="Bookings" padded={false}>
      {showCompany && (
        <div className="flex flex-wrap items-end gap-3 px-4 pt-5 sm:px-6">
          <div className="w-full sm:w-52">
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
          <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </>
      )}

      <Modal
        open={openBooking !== null}
        onClose={() => setOpenBookingId(null)}
        title={openBooking ? `${openBooking.employeeName} · ${openBooking.bookingDate}` : ''}
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setOpenBookingId(null)}>
            Close
          </Button>
        }
      >
        {openBooking && <BookingDetails booking={openBooking} showCompany={showCompany} detailLine={detailLine} />}
      </Modal>
    </Card>
  );
}

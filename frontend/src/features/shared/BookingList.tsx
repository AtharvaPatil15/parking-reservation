import { useCallback, useEffect, useState } from 'react';
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

const PAGE_SIZE = 10;

function displayType(row: AdminBooking) {
  return row.status === 'ALLOCATED' && row.allocationSource ? row.allocationSource : row.bookingType;
}

function displayTypeLabel(row: AdminBooking) {
  return displayType(row).replace('_', ' ');
}

const dateTime = (v: string | null | undefined) => (v ? new Date(v).toLocaleString() : null);

/**
 * One label/value pair in the details popup. Blank strings count as missing too, so a cleared
 * field reads '-' rather than as an empty row.
 */
function DetailLine({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <dt className="text-xs uppercase text-text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium">{value === null || value === undefined || value === '' ? '-' : value}</dd>
    </div>
  );
}

/**
 * Everything the API knows about one booking, for the admin details popup: the driver's own
 * request, then a row per declared passenger.
 *
 * `sameCompany` and `isScored` are reported separately because they answer different questions -
 * whether the passenger resolved to a colleague, and whether they counted toward the carpool score.
 */
function BookingDetails({ booking: b, showCompany }: { booking: AdminBooking; showCompany: boolean }) {
  const members = b.carpoolMembers ?? [];
  return (
    <div className="text-left">
      {/* One column on a phone, widening with the viewport — 3 across is unreadable at 360px. */}
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <DetailLine label="Employee" value={b.employeeName} />
        <DetailLine label="Email" value={b.employeeEmail} />
        {showCompany && <DetailLine label="Company" value={b.companyName} />}
        <DetailLine label="Booking date" value={b.bookingDate} />
        <DetailLine label="Status" value={b.status} />
        <DetailLine label="Type" value={displayTypeLabel(b)} />
        <DetailLine label="People carried" value={b.carpoolPeople} />
        <DetailLine label="Passengers" value={Math.max(0, b.carpoolPeople - 1)} />
        <DetailLine label="Distance" value={b.travelDistanceKm != null ? `${b.travelDistanceKm} km` : null} />
        <DetailLine label="Score" value={b.allocationScore != null ? b.allocationScore.toFixed(1) : null} />
        <DetailLine label="Vehicle slot" value={b.allocatedSlotNumber} />
        <DetailLine label="Submitted" value={dateTime(b.submittedAt)} />
        <DetailLine label="Created" value={dateTime(b.createdAt)} />
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
  // The row itself, not just its id: a background refetch can transiently empty `items`, and
  // re-deriving from the current page would make the popup vanish mid-read. The snapshot is
  // refreshed below while the row is still on the page, so edits are not shown stale.
  const [openBooking, setOpenBooking] = useState<AdminBooking | null>(null);

  // The date is driven by the dashboard-level picker; reset paging when it changes.
  useEffect(() => setPage(1), [date]);

  // Close the details popup when the user navigates or filters away from the row it describes.
  useEffect(() => setOpenBooking(null), [page, date, companyId]);

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

  const columns: Column<AdminBooking>[] = [
    ...(showCompany
      ? [{ key: 'company', header: 'Company', render: (b: AdminBooking) => b.companyName }]
      : []),
    { key: 'employee', header: 'Employee', render: (b) => (
      <div>
        <div className="font-medium">{b.employeeName}</div>
        <div className="text-xs text-text-muted">{b.employeeEmail}</div>
        {/* Earlier attempts for this employee/date, when there is more than one. Hidden below
            `md` — that is where the table becomes a stacked label/value list which already
            carries Type and Status on their own lines, so these chips were a second, wider
            restatement of the two rows directly beneath them. The full history is still one tap
            away under Details, and the desktop table (where the name cell is wide enough for
            them to sit tidily under it) is unchanged. */}
        {b.history && b.history.length > 1 && (
          <div className="mt-1 hidden flex-wrap gap-1 md:flex">
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
      // The panel itself is rendered once, outside the table, as a modal. A fixed-width block
      // inside a horizontally-scrolling cell could never lay out correctly.
      render: (b) => (
        <Button variant="secondary" size="sm" onClick={() => setOpenBooking(b)}>
          Details
        </Button>
      ),
    },
  ];

  const total = bookings.data?.meta.total ?? 0;

  // Reset to page 1 whenever a filter changes (avoids landing on an out-of-range page).
  function onCompany(v: string) { setCompanyId(v); setPage(1); }

  // Prefer the live row so an in-place update is reflected; fall back to the snapshot when a
  // refetch is in flight and `rows` is momentarily empty.
  const shownBooking = openBooking
    ? (rows.find((b) => b.id === openBooking.id) ?? openBooking)
    : null;

  // Stable identity so Modal's keydown/scroll-lock effect doesn't tear down on every re-render
  // (the dashboard re-renders once a second while a countdown is on screen).
  const closeDetails = useCallback(() => setOpenBooking(null), []);

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
        open={shownBooking !== null}
        onClose={closeDetails}
        title={shownBooking ? shownBooking.employeeName : ''}
        size="lg"
        footer={
          <Button variant="secondary" onClick={closeDetails}>
            Close
          </Button>
        }
      >
        {shownBooking && <BookingDetails booking={shownBooking} showCompany={showCompany} />}
      </Modal>
    </Card>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, Select, Table, type Column, type SelectOption } from '../../components';
import { useMyBookings } from '../../api/hooks';
import { BackLink } from '../shared/BackLink';
import { statusTone } from './statusTone';
import type { components } from '../../api/types';

type Booking = components['schemas']['Booking'];
const PAGE_SIZE = 10;
const STATUS_OPTIONS: SelectOption[] = [
  { value: '', label: 'All statuses' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'ALLOCATED', label: 'Allocated' },
  { value: 'WAITLISTED', label: 'Waitlisted' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'RELEASED', label: 'Released' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'EXPIRED', label: 'Expired' },
];

const columns: Column<Booking>[] = [
  { key: 'date', header: 'Date', render: (b) => b.bookingDate },
  { key: 'type', header: 'Type', render: (b) => b.bookingType },
  { key: 'status', header: 'Status', render: (b) => <Badge tone={statusTone(b.status)}>{b.status}</Badge> },
  { key: 'view', header: '', align: 'right', render: (b) => (
      <Link to={`/booking/${b.id}`} className="text-primary hover:underline">
        View
      </Link>
    ) },
];

export function History() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const q = useMyBookings(page, PAGE_SIZE, status);

  const items = q.data?.items ?? [];
  const total = q.data?.meta.total ?? 0;
  // Derive page count from the server's own pageSize (not the local PAGE_SIZE constant):
  // MSW/API responses are the source of truth for how many rows actually came back per page.
  const pageCount = Math.max(1, Math.ceil(total / (q.data?.meta.pageSize ?? PAGE_SIZE)));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <BackLink />
        <h1 className="text-2xl font-semibold tracking-tight">Booking history</h1>
      </div>

      <Card>
        <div className="w-48">
          <Select
            label="Status"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </Card>

      {q.isLoading && !q.data ? (
        <LoadingState label="Loading history…" />
      ) : q.isError ? (
        <ErrorState title="Couldn't load your history" />
      ) : total === 0 ? (
        <EmptyState title="No bookings yet" description="Your booking history will appear here." />
      ) : (
        <>
          <Card padded={false}>
            <Table columns={columns} rows={items} rowKey={(b) => b.id} />
          </Card>
          <div className="flex items-center justify-between">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="text-sm text-text-muted">
              Page {page} of {pageCount}
            </span>
            <Button variant="secondary" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, Table, type Column } from '../../components';
import { useMyBookings } from '../../api/hooks';
import { statusTone } from './statusTone';
import type { components } from '../../api/types';

type Booking = components['schemas']['Booking'];
const PAGE_SIZE = 10;

const columns: Column<Booking>[] = [
  // Booking id doubles as the row's stable identity in this MVP table — surfaced as its
  // own column since bookingDate alone doesn't distinguish rows across pages.
  { key: 'id', header: 'Booking', render: (b) => b.id },
  { key: 'date', header: 'Date', render: (b) => b.bookingDate },
  { key: 'type', header: 'Type', render: (b) => b.bookingType },
  { key: 'status', header: 'Status', render: (b) => <Badge tone={statusTone(b.status)}>{b.status}</Badge> },
  { key: 'view', header: '', align: 'right', render: (b) => (
      <Link to={`/app/booking/${b.id}`} className="text-primary hover:underline">
        View
      </Link>
    ) },
];

export function History() {
  const [page, setPage] = useState(1);
  const q = useMyBookings(page, PAGE_SIZE);

  if (q.isLoading && !q.data) return <LoadingState label="Loading history…" />;
  if (q.isError) return <ErrorState title="Couldn't load your history" />;

  const items = q.data?.items ?? [];
  const total = q.data?.meta.total ?? 0;
  // Derive page count from the server's own pageSize (not the local PAGE_SIZE constant):
  // MSW/API responses are the source of truth for how many rows actually came back per page.
  const pageCount = Math.max(1, Math.ceil(total / (q.data?.meta.pageSize ?? PAGE_SIZE)));

  if (total === 0) return <EmptyState title="No bookings yet" description="Your booking history will appear here." />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Booking history</h1>
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
    </div>
  );
}

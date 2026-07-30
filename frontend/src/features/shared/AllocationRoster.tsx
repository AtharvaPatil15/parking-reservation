import { useEffect, useState } from 'react';
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, Select, Table,
  type Column, type SelectOption,
} from '../../components';
import { useAllocations, useActiveCompanies } from '../../api/hooks';
import type { components } from '../../api/types';

type AllocationRosterItem = components['schemas']['AllocationRosterItem'];
type BookingType = components['schemas']['BookingType'];

const TYPE_OPTIONS: SelectOption[] = [
  { value: '', label: 'All types' },
  { value: 'PRIMARY', label: 'Primary' },
  { value: 'COMMON_POOL', label: 'Common pool' },
];

const PAGE_SIZE = 20;

/**
 * Seat-centric allocation roster — which slot is held by whom, for what date, and whether it came
 * from primary allocation or the common pool. `scope='company'` (Company Admin) is server-scoped to
 * the caller's company; `scope='all'` (Super Admin) shows every company and adds a company filter.
 */
export function AllocationRoster({ scope }: { scope: 'company' | 'all' }) {
  const showCompany = scope === 'all';
  const [date, setDate] = useState('');
  const [type, setType] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [page, setPage] = useState(1);

  // Reset paging whenever a filter changes (avoids landing on an out-of-range page).
  useEffect(() => setPage(1), [date, type, companyId]);

  const companies = useActiveCompanies();
  const roster = useAllocations({
    date: date || undefined,
    type: (type || undefined) as BookingType | undefined,
    companyId: showCompany ? companyId || undefined : undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const companyOptions: SelectOption[] = [
    { value: '', label: 'All companies' },
    ...(companies.data ?? []).map((c) => ({ value: c.id, label: c.name })),
  ];

  const columns: Column<AllocationRosterItem>[] = [
    { key: 'slot', header: 'Slot', className: 'font-medium tabular-nums', render: (a) => a.slotNumber },
    { key: 'employee', header: 'Employee', render: (a) => (
      <div>
        <div className="font-medium">{a.employeeName}</div>
        <div className="text-xs text-text-muted">{a.employeeEmail}</div>
      </div>
    ) },
    ...(showCompany
      ? [{ key: 'company', header: 'Company', render: (a: AllocationRosterItem) => a.companyName }]
      : []),
    { key: 'date', header: 'Date', className: 'tabular-nums', render: (a) => a.bookingDate },
    {
      key: 'type', header: 'Type',
      render: (a) => (
        <Badge tone={a.allocationType === 'COMMON_POOL' ? 'accent' : 'primary'}>
          {a.allocationType === 'COMMON_POOL' ? 'Common pool' : 'Primary'}
        </Badge>
      ),
    },
    { key: 'score', header: 'Score', align: 'right', className: 'tabular-nums', render: (a) => (a.allocationScore != null ? a.allocationScore.toFixed(1) : '—') },
  ];

  const meta = roster.data?.meta;
  const total = meta?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card title="Allocated seats" padded={false}>
      <div className="flex flex-wrap items-end gap-3 px-6 pt-5">
        <div className="w-44">
          <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} hint="Blank = all dates" />
        </div>
        <div className="w-40">
          <Select label="Type" options={TYPE_OPTIONS} value={type} onChange={(e) => setType(e.target.value)} />
        </div>
        {showCompany && (
          <div className="w-52">
            <Select label="Company" options={companyOptions} value={companyId} onChange={(e) => setCompanyId(e.target.value)} />
          </div>
        )}
        {(date || type || companyId) && (
          <Button variant="secondary" size="sm" onClick={() => { setDate(''); setType(''); setCompanyId(''); }}>
            Clear
          </Button>
        )}
      </div>

      {roster.isLoading ? (
        <LoadingState label="Loading allocations…" />
      ) : roster.isError ? (
        <ErrorState title="Couldn't load allocations" />
      ) : !roster.data || roster.data.items.length === 0 ? (
        <EmptyState
          title="No allocated seats"
          description={date ? `No seats allocated for ${date}.` : 'Seats appear here once allocation has run.'}
        />
      ) : (
        <>
          <Table columns={columns} rows={roster.data.items} rowKey={(a) => a.id} className="mt-4" />
          <div className="flex items-center justify-between px-6 py-3 text-sm text-text-muted">
            <span>{total} seat{total === 1 ? '' : 's'}</span>
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

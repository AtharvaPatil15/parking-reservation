import { useState } from 'react';
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, Modal, Pager, Table, useToast,
  type Column,
} from '../../components';
import {
  useCompanies, useCreateCompany, useCompanyQuota, useSetCompanyQuota, useCompanyQuotaSummary,
  useSetCompanyStatus, useDeleteCompany,
} from '../../api/hooks';
import { apiErrorText } from '../../api/http';
import { nextBookableWeekday } from '../../lib/dates';
import type { components } from '../../api/types';

type Company = components['schemas']['Company'];

interface RowActions {
  onQuota: (c: Company) => void;
  onToggleStatus: (c: Company) => void;
  onDelete: (c: Company) => void;
  /** Id of the company whose status is mid-flight, so only that row's button spins. */
  pendingStatusId: string | null;
}

const columns = (
  { onQuota, onToggleStatus, onDelete, pendingStatusId }: RowActions,
  assignedFor: (companyId: string) => number | null,
): Column<Company>[] => [
  { key: 'name', header: 'Company', render: (c) => <span className="font-medium text-text">{c.name}</span> },
  { key: 'code', header: 'Code', render: (c) => <span className="tabular-nums">{c.code}</span> },
  {
    key: 'status', header: 'Status',
    render: (c) => <Badge tone={c.status === 'ACTIVE' ? 'success' : 'neutral'}>{c.status}</Badge>,
  },
  {
    key: 'assigned', header: 'Assigned', align: 'right',
    render: (c) => {
      const n = assignedFor(c.id);
      return <span className="tabular-nums text-text">{n === null ? '—' : n}</span>;
    },
  },
  {
    key: 'actions', header: '', align: 'right',
    render: (c) => (
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={() => onQuota(c)}>
          Manage quota
        </Button>
        {/* Reversible, so it acts immediately — no confirmation. The label states the resulting state,
            not the current one, which is what the badge in the Status column is already for. */}
        <Button
          size="sm"
          variant="secondary"
          loading={pendingStatusId === c.id}
          onClick={() => onToggleStatus(c)}
        >
          {c.status === 'ACTIVE' ? 'Disable' : 'Enable'}
        </Button>
        <Button size="sm" variant="danger" onClick={() => onDelete(c)}>
          Delete
        </Button>
      </div>
    ),
  },
];

/**
 * Delete confirmation. The server refuses (409) while the tenant still has users or live bookings, so
 * this dialog does not try to pre-check anything — it states the consequence and surfaces whatever the
 * server says, which is the only account that is actually authoritative.
 */
function DeleteModal({ company, onClose }: { company: Company; onClose: () => void }) {
  const del = useDeleteCompany();
  const { toast } = useToast();
  const error = apiErrorText(del.error);

  function onConfirm() {
    del.mutate(company.id, {
      onSuccess: () => { toast(`${company.name} deleted.`, { tone: 'success' }); onClose(); },
    });
  }

  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={`Delete ${company.name}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={del.isPending} onClick={onConfirm}>Delete company</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-text-muted">
          {company.name} will be removed from the company list, the registration dropdown and the gate
          capacity panel. Past bookings and gate records are kept for reporting.
        </p>
        <p className="text-text-muted">
          Only possible once the company has no users and no bookings still in play. Its code{' '}
          <span className="font-medium text-text">{company.code}</span> is released for reuse.
        </p>
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

function QuotaModal({ company, onClose }: { company: Company; onClose: () => void }) {
  const quota = useCompanyQuota(company.id);
  const setQuota = useSetCompanyQuota(company.id);
  const { toast } = useToast();
  const [slotCount, setSlotCount] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(nextBookableWeekday());
  const error = apiErrorText(setQuota.error);
  const count = Number(slotCount);
  const countInvalid = slotCount.trim() !== '' && (!Number.isInteger(count) || count < 0);

  function onSubmit() {
    if (slotCount.trim() === '' || countInvalid) return;
    setQuota.mutate(
      { slotCount: count, effectiveFrom },
      // Close the dialog on success; the mutation invalidates the summary so the "Assigned" column
      // on the table behind it updates on its own.
      { onSuccess: () => { toast('Quota updated.', { tone: 'success' }); onClose(); } },
    );
  }

  return (
    <Modal open onClose={onClose} title={`Quota — ${company.name}`}>
      <div className="space-y-4">
        {quota.isLoading ? (
          <LoadingState label="Loading quota…" />
        ) : quota.data && quota.data.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {quota.data.map((q) => (
              <li key={q.id} className="flex justify-between">
                <span className="text-text-muted">from {q.effectiveFrom}</span>
                <span className="font-medium tabular-nums">{q.slotCount} slots</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-muted">No quota set yet.</p>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28">
            <Input
              label="Slots"
              type="number"
              min={0}
              value={slotCount}
              onChange={(e) => setSlotCount(e.target.value)}
              error={countInvalid ? 'Whole number ≥ 0' : undefined}
            />
          </div>
          <div className="w-44">
            <Input label="Effective from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </div>
          <Button onClick={onSubmit} loading={setQuota.isPending} disabled={slotCount.trim() === '' || countInvalid}>
            Set quota
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

export function Companies() {
  const [page, setPage] = useState(1);
  const companies = useCompanies(page);
  const create = useCreateCompany();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [active, setActive] = useState<Company | null>(null);
  const [deleting, setDeleting] = useState<Company | null>(null);
  const [assignedOn, setAssignedOn] = useState(nextBookableWeekday());
  const summary = useCompanyQuotaSummary(assignedOn);
  const setStatus = useSetCompanyStatus();
  const createError = apiErrorText(create.error);
  // The status toggle has no dialog to show its error in, so it reports through the toast instead.
  const statusError = apiErrorText(setStatus.error);

  // companyId → assigned slots for the picked date (null while loading, so the column shows '—').
  const assignedFor = (companyId: string): number | null => {
    if (!summary.data) return null;
    return summary.data.find((e) => e.companyId === companyId)?.assignedSlots ?? 0;
  };

  function onCreate() {
    if (!name.trim() || !code.trim()) return;
    create.mutate(
      { name: name.trim(), code: code.trim().toUpperCase() },
      { onSuccess: () => { toast('Company created.', { tone: 'success' }); setName(''); setCode(''); } },
    );
  }

  function onToggleStatus(c: Company) {
    const status = c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setStatus.mutate(
      { id: c.id, status },
      {
        onSuccess: () =>
          toast(`${c.name} ${status === 'ACTIVE' ? 'enabled' : 'disabled'}.`, { tone: 'success' }),
      },
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Companies</h2>
        <p className="text-text-muted">Tenants and their parking quota.</p>
      </div>

      <Card title="Add company">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            {/* Code below carries a hint; reserve the same line here so both inputs stay in line. */}
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} hintReserve />
          </div>
          <div className="w-40">
            <Input label="Code" value={code} onChange={(e) => setCode(e.target.value)} hint="Short tenant code" />
          </div>
          <Button className="mb-[1.625rem]" onClick={onCreate} loading={create.isPending} disabled={!name.trim() || !code.trim()}>
            Add company
          </Button>
        </div>
        {createError && <p role="alert" className="mt-3 text-sm text-danger">{createError}</p>}
      </Card>

      <Card title="All companies" padded={false}>
        <div className="flex flex-wrap items-end gap-3 px-4 pt-4">
          <div className="w-44">
            <Input
              label="Assigned on"
              type="date"
              value={assignedOn}
              onChange={(e) => setAssignedOn(e.target.value)}
              hint="Effective quota for this date"
            />
          </div>
        </div>
        {companies.isLoading ? (
          <LoadingState label="Loading companies…" />
        ) : companies.isError ? (
          <ErrorState title="Couldn't load companies" />
        ) : !companies.data || companies.data.items.length === 0 ? (
          <EmptyState title="No companies" />
        ) : (
          <>
            <Table
              columns={columns(
                {
                  onQuota: setActive,
                  onToggleStatus,
                  onDelete: setDeleting,
                  pendingStatusId: setStatus.isPending ? setStatus.variables.id : null,
                },
                assignedFor,
              )}
              rows={companies.data.items}
              rowKey={(c) => c.id}
            />
            <Pager page={companies.data.meta.page} pageSize={companies.data.meta.pageSize} total={companies.data.meta.total} onPage={setPage} />
          </>
        )}
        {statusError && <p role="alert" className="px-4 pb-4 text-sm text-danger sm:px-6">{statusError}</p>}
      </Card>

      {active && <QuotaModal company={active} onClose={() => setActive(null)} />}
      {deleting && <DeleteModal company={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

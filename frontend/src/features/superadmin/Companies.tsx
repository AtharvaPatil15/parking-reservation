import { useState } from 'react';
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, Modal, Pager, Table, useToast,
  type Column,
} from '../../components';
import {
  useCompanies, useCreateCompany, useCompanyQuota, useSetCompanyQuota, useCompanyQuotaSummary,
} from '../../api/hooks';
import { apiErrorText } from '../../api/http';
import { nextBookableWeekday } from '../../lib/dates';
import type { components } from '../../api/types';

type Company = components['schemas']['Company'];

const columns = (
  onQuota: (c: Company) => void,
  assignedFor: (companyId: string) => number | null,
): Column<Company>[] => [
  { key: 'name', header: 'Company', stackedBare: true, render: (c) => <span className="font-medium text-text">{c.name}</span> },
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
    key: 'actions', header: '', align: 'right', stackedBare: true,
    render: (c) => (
      <Button size="sm" variant="secondary" onClick={() => onQuota(c)}>
        Manage quota
      </Button>
    ),
  },
];

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

        <div className="flex flex-wrap items-start gap-3">
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
          <Button
            className="field-aligned"
            onClick={onSubmit}
            loading={setQuota.isPending}
            disabled={slotCount.trim() === '' || countInvalid}
          >
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
  const [assignedOn, setAssignedOn] = useState(nextBookableWeekday());
  const summary = useCompanyQuotaSummary(assignedOn);
  const createError = apiErrorText(create.error);

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

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-4xl">Companies</h1>
        <p className="text-text-muted">Tenants and their parking quota.</p>
      </div>

      <Card title="Add company">
        {/* items-start + .field-aligned, matching every other form row — see the note in
            styles/index.css. This previously needed `hintReserve` on Name plus a magic
            `mb-[1.625rem]` on the button to fight `items-end`; aligning from the top
            instead means neither is necessary, and the fields keep their natural heights. */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-56">
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="w-40">
            <Input label="Code" value={code} onChange={(e) => setCode(e.target.value)} hint="Short tenant code" />
          </div>
          <Button
            className="field-aligned"
            onClick={onCreate}
            loading={create.isPending}
            disabled={!name.trim() || !code.trim()}
          >
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
            <Table columns={columns(setActive, assignedFor)} rows={companies.data.items} rowKey={(c) => c.id} />
            <Pager page={companies.data.meta.page} pageSize={companies.data.meta.pageSize} total={companies.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>

      {active && <QuotaModal company={active} onClose={() => setActive(null)} />}
    </div>
  );
}

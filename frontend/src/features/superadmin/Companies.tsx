import { useState } from 'react';
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, Modal, Table, useToast,
  type Column,
} from '../../components';
import { useCompanies, useCreateCompany, useCompanyQuota, useSetCompanyQuota } from '../../api/hooks';
import { ApiError } from '../../api/http';
import { nextBookableWeekday } from '../../lib/dates';
import type { components } from '../../api/types';

type Company = components['schemas']['Company'];

const columns = (onQuota: (c: Company) => void): Column<Company>[] => [
  { key: 'name', header: 'Company', render: (c) => <span className="font-medium text-text">{c.name}</span> },
  { key: 'code', header: 'Code', render: (c) => <span className="tabular-nums">{c.code}</span> },
  {
    key: 'status', header: 'Status',
    render: (c) => <Badge tone={c.status === 'ACTIVE' ? 'success' : 'neutral'}>{c.status}</Badge>,
  },
  {
    key: 'actions', header: '', align: 'right',
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
  const error = setQuota.error instanceof ApiError ? setQuota.error.message : null;
  const count = Number(slotCount);
  const countInvalid = slotCount.trim() !== '' && (!Number.isInteger(count) || count < 0);

  function onSubmit() {
    if (slotCount.trim() === '' || countInvalid) return;
    setQuota.mutate(
      { slotCount: count, effectiveFrom },
      { onSuccess: () => { toast('Quota updated.', { tone: 'success' }); setSlotCount(''); } },
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
  const companies = useCompanies();
  const create = useCreateCompany();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [active, setActive] = useState<Company | null>(null);
  const createError = create.error instanceof ApiError ? create.error.message : null;

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
        <h2 className="text-xl font-semibold tracking-tight">Companies</h2>
        <p className="text-text-muted">Tenants and their parking quota.</p>
      </div>

      <Card title="Add company">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="w-40">
            <Input label="Code" value={code} onChange={(e) => setCode(e.target.value)} hint="Short tenant code" />
          </div>
          <Button onClick={onCreate} loading={create.isPending} disabled={!name.trim() || !code.trim()}>
            Add company
          </Button>
        </div>
        {createError && <p role="alert" className="mt-3 text-sm text-danger">{createError}</p>}
      </Card>

      <Card title="All companies" padded={false}>
        {companies.isLoading ? (
          <LoadingState label="Loading companies…" />
        ) : companies.isError ? (
          <ErrorState title="Couldn't load companies" />
        ) : !companies.data || companies.data.items.length === 0 ? (
          <EmptyState title="No companies" />
        ) : (
          <Table columns={columns(setActive)} rows={companies.data.items} rowKey={(c) => c.id} />
        )}
      </Card>

      {active && <QuotaModal company={active} onClose={() => setActive(null)} />}
    </div>
  );
}

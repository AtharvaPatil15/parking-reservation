import { useState } from 'react';
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, Select, Table, useToast,
  type Column, type SelectOption,
} from '../../components';
import { useBlocks, useCreateBlock, useDeleteBlock } from '../../api/hooks';
import { useAuth } from '../../lib/auth';
import { ApiError } from '../../api/http';
import { nextBookableWeekday } from '../../lib/dates';
import type { components } from '../../api/types';

type SlotBlock = components['schemas']['SlotBlock'];
type BlockReason = components['schemas']['BlockReason'];

const REASONS: SelectOption[] = [
  { value: 'RESERVED_VISITOR', label: 'Reserved — visitor' },
  { value: 'RESERVED_LEADERSHIP', label: 'Reserved — leadership' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'COMPANY_EVENT', label: 'Company event' },
  { value: 'EMERGENCY', label: 'Emergency' },
  { value: 'OTHER', label: 'Other' },
];

export function Blocks() {
  const { user } = useAuth();
  const companyId = user?.companyId ?? undefined;
  const blocks = useBlocks(companyId);
  const create = useCreateBlock(companyId ?? '');
  const remove = useDeleteBlock(companyId ?? '');
  const { toast } = useToast();

  const [blockedCount, setBlockedCount] = useState('');
  const [startDate, setStartDate] = useState(nextBookableWeekday());
  const [endDate, setEndDate] = useState(nextBookableWeekday());
  const [reason, setReason] = useState<BlockReason>('MAINTENANCE');
  const [reasonText, setReasonText] = useState('');
  const createError = create.error instanceof ApiError ? create.error.message : null;
  const count = Number(blockedCount);
  const countInvalid = blockedCount.trim() !== '' && (!Number.isInteger(count) || count < 1);
  const rangeInvalid = Boolean(startDate && endDate && endDate < startDate);
  const canSubmit = blockedCount.trim() !== '' && !countInvalid && !rangeInvalid;

  function onCreate() {
    if (!canSubmit) return;
    create.mutate(
      { blockedCount: count, startDate, endDate, reason, reasonText: reasonText.trim() || null },
      { onSuccess: () => { toast('Block created.', { tone: 'success' }); setBlockedCount(''); setReasonText(''); } },
    );
  }

  function onRemove(id: string) {
    remove.mutate(id, { onSuccess: () => toast('Block removed.', { tone: 'success' }) });
  }

  const columns: Column<SlotBlock>[] = [
    { key: 'dates', header: 'Dates', render: (b) => `${b.startDate} → ${b.endDate}` },
    { key: 'count', header: 'Slots', align: 'right', className: 'tabular-nums', render: (b) => b.blockedCount },
    { key: 'reason', header: 'Reason', render: (b) => <Badge tone="neutral">{b.reason}</Badge> },
    { key: 'note', header: 'Note', render: (b) => b.reasonText ?? '—' },
    {
      key: 'actions', header: '', align: 'right',
      render: (b) => (
        <Button size="sm" variant="secondary" loading={remove.isPending} onClick={() => onRemove(b.id)}>
          Remove
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Quota blocks</h2>
        <p className="text-text-muted">Hold back a count of your quota for a date range, with a reason.</p>
      </div>

      <Card title="Add block">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-24">
            <Input
              label="Slots"
              type="number"
              min={1}
              value={blockedCount}
              onChange={(e) => setBlockedCount(e.target.value)}
              error={countInvalid ? 'Whole number ≥ 1' : undefined}
            />
          </div>
          <div className="w-40">
            <Input label="Start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="w-40">
            <Input
              label="End"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              error={rangeInvalid ? 'End must be on/after start' : undefined}
            />
          </div>
          <div className="w-48">
            <Select label="Reason" options={REASONS} value={reason} onChange={(e) => setReason(e.target.value as BlockReason)} />
          </div>
          <div className="w-48">
            <Input label="Note" value={reasonText} onChange={(e) => setReasonText(e.target.value)} hint="Optional" />
          </div>
          <Button onClick={onCreate} loading={create.isPending} disabled={!canSubmit}>
            Add block
          </Button>
        </div>
        {createError && <p role="alert" className="mt-3 text-sm text-danger">{createError}</p>}
      </Card>

      <Card title="Active blocks" padded={false}>
        {blocks.isLoading ? (
          <LoadingState label="Loading blocks…" />
        ) : blocks.isError ? (
          <ErrorState title="Couldn't load blocks" />
        ) : !blocks.data || blocks.data.items.length === 0 ? (
          <EmptyState title="No blocks" description="None of your quota is held back." />
        ) : (
          <Table columns={columns} rows={blocks.data.items} rowKey={(b) => b.id} />
        )}
      </Card>
    </div>
  );
}

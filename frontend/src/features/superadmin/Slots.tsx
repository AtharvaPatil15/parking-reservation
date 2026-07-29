import { useState } from 'react';
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, Select, Table, useToast,
  type BadgeTone, type Column, type SelectOption,
} from '../../components';
import { useCreateSlot, useSlots } from '../../api/hooks';
import { ApiError } from '../../api/http';
import type { components } from '../../api/types';

type ParkingSlot = components['schemas']['ParkingSlot'];
type SlotType = components['schemas']['SlotType'];

const SLOT_TYPES: SelectOption[] = [
  { value: 'STANDARD', label: 'Standard' },
  { value: 'ACCESSIBLE', label: 'Accessible' },
  { value: 'EV_CHARGING', label: 'EV charging' },
  { value: 'VISITOR', label: 'Visitor' },
  { value: 'RESERVED', label: 'Reserved' },
];

function statusTone(status: ParkingSlot['status']): BadgeTone {
  switch (status) {
    case 'AVAILABLE': return 'success';
    case 'BLOCKED':
    case 'UNDER_MAINTENANCE':
    case 'INACTIVE': return 'danger';
    case 'BOOKED': return 'primary';
    default: return 'neutral';
  }
}

const columns: Column<ParkingSlot>[] = [
  { key: 'slotNumber', header: 'Slot', render: (s) => <span className="font-medium text-text">{s.slotNumber}</span> },
  { key: 'area', header: 'Area', render: (s) => s.parkingAreaId },
  { key: 'type', header: 'Type', render: (s) => <Badge tone="neutral">{s.slotType}</Badge> },
  { key: 'status', header: 'Status', render: (s) => <Badge tone={statusTone(s.status)}>{s.status}</Badge> },
];

export function Slots() {
  const slots = useSlots();
  const create = useCreateSlot();
  const { toast } = useToast();
  const [slotNumber, setSlotNumber] = useState('');
  const [parkingAreaId, setParkingAreaId] = useState('area-1');
  const [slotType, setSlotType] = useState<SlotType>('STANDARD');
  const createError = create.error instanceof ApiError ? create.error.message : null;

  function onCreate() {
    if (!slotNumber.trim() || !parkingAreaId.trim()) return;
    create.mutate(
      {
        slotNumber: slotNumber.trim(),
        parkingAreaId: parkingAreaId.trim(),
        slotType,
        hasEvCharging: slotType === 'EV_CHARGING',
        isAccessible: slotType === 'ACCESSIBLE',
      },
      { onSuccess: () => { toast('Slot created.', { tone: 'success' }); setSlotNumber(''); } },
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Parking slots</h2>
        <p className="text-text-muted">The physical inventory allocation draws from.</p>
      </div>

      <Card title="Add slot">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Input label="Slot number" value={slotNumber} onChange={(e) => setSlotNumber(e.target.value)} />
          </div>
          <div className="w-40">
            <Input label="Area" value={parkingAreaId} onChange={(e) => setParkingAreaId(e.target.value)} />
          </div>
          <div className="w-44">
            <Select label="Type" options={SLOT_TYPES} value={slotType} onChange={(e) => setSlotType(e.target.value as SlotType)} />
          </div>
          <Button onClick={onCreate} loading={create.isPending} disabled={!slotNumber.trim() || !parkingAreaId.trim()}>
            Add slot
          </Button>
        </div>
        {createError && <p role="alert" className="mt-3 text-sm text-danger">{createError}</p>}
      </Card>

      <Card title="All slots" padded={false}>
        {slots.isLoading ? (
          <LoadingState label="Loading slots…" />
        ) : slots.isError ? (
          <ErrorState title="Couldn't load slots" />
        ) : !slots.data || slots.data.items.length === 0 ? (
          <EmptyState title="No slots" />
        ) : (
          <Table columns={columns} rows={slots.data.items} rowKey={(s) => s.id} />
        )}
      </Card>
    </div>
  );
}

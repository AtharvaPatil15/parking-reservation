import { useState } from 'react';
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, Select, Table, useToast,
  type BadgeTone, type Column, type SelectOption,
} from '../../components';
import { useCreateSlot, useSlots, useParkingAreas, useUpdateSlot, useDeleteSlot } from '../../api/hooks';
import { apiErrorText } from '../../api/http';
import type { components } from '../../api/types';

type ParkingSlot = components['schemas']['ParkingSlot'];

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

const PAGE_SIZE = 10;

export function Slots() {
  const [page, setPage] = useState(1);
  const slots = useSlots(page, PAGE_SIZE);
  const areas = useParkingAreas();
  const create = useCreateSlot();
  const update = useUpdateSlot();
  const remove = useDeleteSlot();
  const { toast } = useToast();
  const [slotNumber, setSlotNumber] = useState('');
  const [areaId, setAreaId] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const createError = apiErrorText(create.error);

  const total = slots.data?.meta.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const areaOptions: SelectOption[] = (areas.data ?? []).map((a) => ({ value: a.id, label: a.name }));
  const areaName = (id: string) => (areas.data ?? []).find((a) => a.id === id)?.name ?? id;
  const parkingAreaId = areaId || areas.data?.[0]?.id || '';

  function onCreate() {
    if (!slotNumber.trim() || !parkingAreaId) return;
    create.mutate(
      {
        slotNumber: slotNumber.trim(),
        parkingAreaId,
        slotType: 'STANDARD', // demo: plain car slots only — no EV/accessible/visitor types
        hasEvCharging: false,
        isAccessible: false,
      },
      {
        onSuccess: () => {
          toast('Slot created.', { tone: 'success' });
          setSlotNumber('');
          setPage(1); // newest-first: jump to page 1 so the just-added slot is visible at the top
        },
      },
    );
  }

  function onToggle(slot: ParkingSlot) {
    const next = slot.status === 'INACTIVE' ? 'AVAILABLE' : 'INACTIVE';
    setBusyId(slot.id);
    update.mutate(
      { id: slot.id, status: next },
      {
        onSuccess: () => toast(next === 'INACTIVE' ? 'Slot deactivated.' : 'Slot activated.', { tone: 'success' }),
        onSettled: () => setBusyId(null),
      },
    );
  }

  function onDelete(slot: ParkingSlot) {
    setBusyId(slot.id);
    remove.mutate(slot.id, {
      onSuccess: () => toast(`Slot ${slot.slotNumber} removed.`, { tone: 'success' }),
      onSettled: () => setBusyId(null),
    });
  }

  const columns: Column<ParkingSlot>[] = [
    { key: 'slotNumber', header: 'Slot', render: (s) => <span className="font-medium text-text">{s.slotNumber}</span> },
    { key: 'area', header: 'Area', render: (s) => areaName(s.parkingAreaId) },
    { key: 'status', header: 'Status', render: (s) => <Badge tone={statusTone(s.status)}>{s.status}</Badge> },
    {
      key: 'actions', header: '', align: 'right',
      render: (s) => (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={busyId === s.id && update.isPending}
            disabled={busyId !== null}
            onClick={() => onToggle(s)}
          >
            {s.status === 'INACTIVE' ? 'Activate' : 'Deactivate'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={busyId === s.id && remove.isPending}
            disabled={busyId !== null}
            onClick={() => onDelete(s)}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Parking slots</h2>
        <p className="text-text-muted">The physical inventory allocation draws from. Deactivated slots don't count as in service.</p>
      </div>

      <Card title="Add slot">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Input label="Slot number" value={slotNumber} onChange={(e) => setSlotNumber(e.target.value)} />
          </div>
          <div className="w-48">
            <Select
              label="Area"
              placeholder={areas.isLoading ? 'Loading areas…' : 'Select an area'}
              options={areaOptions}
              value={parkingAreaId}
              onChange={(e) => setAreaId(e.target.value)}
            />
          </div>
          <Button onClick={onCreate} loading={create.isPending} disabled={!slotNumber.trim() || !parkingAreaId}>
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
          <>
            <Table columns={columns} rows={slots.data.items} rowKey={(s) => s.id} />
            <div className="flex items-center justify-between px-6 py-3 text-sm text-text-muted">
              <span>{total} slot{total === 1 ? '' : 's'}</span>
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
    </div>
  );
}

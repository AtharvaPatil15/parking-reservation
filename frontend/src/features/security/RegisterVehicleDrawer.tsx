import { useEffect, useState } from 'react';
import { Button, Drawer, Input, Select, useToast } from '../../components';
import { useCreateVehicleRegistration, useGateCapacity } from '../../api/hooks';
import { ApiError } from '../../api/http';

export interface RegisterVehicleDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Pre-fill when opened from a failed lookup — the guard has already typed the plate once. */
  initialNumber?: string;
}

const VEHICLE_TYPES = [
  { value: 'CAR', label: 'Car' },
  { value: 'BIKE', label: 'Bike' },
  { value: 'EV_CAR', label: 'Electric car' },
  { value: 'EV_BIKE', label: 'Electric bike' },
];

/**
 * Register a walk-in car — a new employee at the barrier whose vehicle nobody had added.
 *
 * Asks only what a guard can actually establish standing at a boom: the plate, who says they own it, how
 * to reach them, and which company they claim. Deliberately no address / pin code / home distance — those
 * belong to a user account, this creates none, and a guard cannot verify them anyway.
 *
 * The company list comes from the capacity endpoint rather than `GET /companies`, which is Super-Admin
 * only. That is not a workaround: it means the picker can show how many slots each company has free,
 * which is exactly what the guard needs to know before phoning that company's admin for approval.
 */
export function RegisterVehicleDrawer({ open, onClose, initialNumber }: RegisterVehicleDrawerProps) {
  const capacity = useGateCapacity();
  const create = useCreateVehicleRegistration();
  const { toast } = useToast();

  const [vehicleNumber, setVehicleNumber] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [vehicleType, setVehicleType] = useState('CAR');
  const [makeModel, setMakeModel] = useState('');

  // Fresh form per opening, seeded with whatever the guard had already typed at the lookup.
  useEffect(() => {
    if (!open) return;
    setVehicleNumber(initialNumber ?? '');
    setOwnerName('');
    setContactNumber('');
    setOwnerEmail('');
    setCompanyId('');
    setVehicleType('CAR');
    setMakeModel('');
    create.reset();
    // `create` is a stable mutation object; depending on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialNumber]);

  const companyOptions = (capacity.data?.rows ?? []).map((r) => ({
    value: r.companyId,
    label: `${r.companyName} — ${r.free} free`,
  }));

  const plateOk = vehicleNumber.trim().length >= 4;
  const nameOk = ownerName.trim().length >= 2;
  const canSubmit = plateOk && nameOk && companyId !== '';
  const chosen = capacity.data?.rows.find((r) => r.companyId === companyId);

  function submit() {
    if (!canSubmit) return;
    create.mutate(
      {
        vehicleNumber: vehicleNumber.trim(),
        ownerName: ownerName.trim(),
        companyId,
        vehicleType: vehicleType as 'CAR' | 'BIKE' | 'EV_CAR' | 'EV_BIKE',
        ...(contactNumber.trim() ? { contactNumber: contactNumber.trim() } : {}),
        ...(ownerEmail.trim() ? { ownerEmail: ownerEmail.trim() } : {}),
        ...(makeModel.trim() ? { makeModel: makeModel.trim() } : {}),
      },
      {
        onSuccess: (r) => {
          toast(
            `Sent to ${r.companyName} for approval. Call them — the car waits until they approve it.`,
            { tone: 'info' },
          );
          onClose();
        },
      },
    );
  }

  const errorMsg =
    create.error instanceof ApiError
      ? create.error.message
      : create.isError
        ? 'Something went wrong. Please try again.'
        : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Register a car"
      description="For a new employee whose car is not in the registry. Their company's admin has to approve it before you can let them in."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.isPending} disabled={!canSubmit}>
            Send for approval
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {errorMsg && (
          <p
            role="alert"
            className="rounded-control border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger"
          >
            {errorMsg}
          </p>
        )}

        <Input
          label="Car number"
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="MH 12 AB 1234"
          value={vehicleNumber}
          onChange={(e) => setVehicleNumber(e.target.value)}
          hint="Spacing and case do not matter."
        />
        <Input
          label="Name"
          autoComplete="off"
          placeholder="As they gave it to you"
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
        />
        <Select
          label="Company"
          options={[{ value: '', label: 'Pick a company…' }, ...companyOptions]}
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          hint={
            chosen && chosen.free === 0
              ? 'This company has no free slots today — they can still approve the car, but there is nowhere to park it.'
              : 'Whoever administers this company approves the request.'
          }
        />
        <Input
          label="Contact number"
          autoComplete="off"
          placeholder="Optional"
          value={contactNumber}
          onChange={(e) => setContactNumber(e.target.value)}
        />
        <Input
          label="Owner username"
          type="text"
          autoComplete="off"
          placeholder="Optional"
          value={ownerEmail}
          onChange={(e) => setOwnerEmail(e.target.value)}
          hint="If they already have an account, this is what links the car to it."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Type"
            options={VEHICLE_TYPES}
            value={vehicleType}
            onChange={(e) => setVehicleType(e.target.value)}
          />
          <Input
            label="Make / model"
            autoComplete="off"
            placeholder="Optional"
            value={makeModel}
            onChange={(e) => setMakeModel(e.target.value)}
          />
        </div>
      </div>
    </Drawer>
  );
}

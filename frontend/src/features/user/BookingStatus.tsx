import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Badge, Button, Card, ErrorState, Input, LoadingState, Modal, Select, useToast, type SelectOption,
} from '../../components';
import { useBooking, useReleaseBooking, useUpdateBooking } from '../../api/hooks';
import { apiErrorText } from '../../api/http';
import { isTodayOrFuture } from '../../lib/dates';
import { BackLink } from '../shared/BackLink';
import { statusTone } from './statusTone';
import type { components } from '../../api/types';

type UpdateBookingRequest = components['schemas']['UpdateBookingRequest'];
type VehicleType = components['schemas']['VehicleType'];

const VEHICLE_TYPES: SelectOption[] = [
  { value: 'CAR', label: 'Car' },
  { value: 'BIKE', label: 'Bike' },
  { value: 'EV_CAR', label: 'EV Car' },
  { value: 'EV_BIKE', label: 'EV Bike' },
  { value: 'OTHER', label: 'Other' },
];

function Row({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd className={emphasize ? 'text-right font-semibold text-text' : 'text-right text-text'}>{value}</dd>
    </>
  );
}

export function BookingStatus() {
  const { id } = useParams();
  const booking = useBooking(id);
  const release = useReleaseBooking();
  const update = useUpdateBooking(id ?? '');
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [vehicleType, setVehicleType] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [people, setPeople] = useState('1');
  const [special, setSpecial] = useState('');
  const [members, setMembers] = useState<{ name: string; employeeEmail: string }[]>([]);

  if (booking.isLoading) return <LoadingState label="Loading booking…" />;
  if (booking.isError || !booking.data) {
    return (
      <ErrorState
        title="Couldn't load booking"
        action={
          <Link to="/my-bookings" className="text-primary hover:underline">
            Back to my bookings
          </Link>
        }
      />
    );
  }

  const b = booking.data;
  const sb = b.scoreBreakdown;
  // Release only makes sense while the booking date can still be reallocated to the
  // waitlist (F3). A past date is already resolved, so hide the control (KI-1); the
  // live backend also rejects an ineligible release with 409/422.
  const canRelease = b.status === 'ALLOCATED' && isTodayOrFuture(b.bookingDate);
  // Edit is allowed only while the request is still pending and the date can still be booked; the
  // backend re-checks the primary cutoff and rejects a late edit with 422.
  const canEdit = b.status === 'SUBMITTED' && isTodayOrFuture(b.bookingDate);
  const editError = apiErrorText(update.error);

  function onRelease() {
    if (!id) return;
    release.mutate(id, {
      onSuccess: () => {
        setConfirmOpen(false);
        toast('Slot released.', { tone: 'success' });
      },
    });
  }

  const peopleNum = Math.max(1, Number(people) || 1);
  function addMember() {
    setMembers((prev) => [...prev, { name: '', employeeEmail: '' }]);
  }
  function removeMember(i: number) {
    setMembers((prev) => prev.filter((_, idx) => idx !== i));
  }
  function setMember(i: number, field: 'name' | 'employeeEmail', val: string) {
    setMembers((prev) => prev.map((m, idx) => (idx === i ? { ...m, [field]: val } : m)));
  }

  function openEdit() {
    setVehicleType(b.vehicleType ?? '');
    setVehicleNumber(b.vehicleNumber ?? '');
    setPeople(String(b.carpoolMemberCount + 1));
    setSpecial(b.specialRequirement ?? '');
    setMembers((b.carpoolMembers ?? []).map((m) => ({ name: m.name, employeeEmail: m.employeeEmail ?? '' })));
    setEditOpen(true);
  }

  function onSaveEdit() {
    if (!id) return;
    const cleanedMembers = members
      .filter((m) => m.name.trim())
      .map((m) => ({ name: m.name.trim(), employeeEmail: m.employeeEmail.trim() || undefined }));
    const body: UpdateBookingRequest = {
      // Keep people ≥ declared members + driver so the edit is internally consistent.
      carpoolPeople: Math.max(peopleNum, cleanedMembers.length + 1),
      vehicleNumber: vehicleNumber.trim() || null,
      specialRequirement: special.trim() || null,
      carpoolMembers: cleanedMembers,
      ...(vehicleType ? { vehicleType: vehicleType as VehicleType } : {}),
    };
    update.mutate(body, {
      onSuccess: () => {
        setEditOpen(false);
        toast('Booking updated.', { tone: 'success' });
      },
    });
  }

  return (
    <div className="space-y-6">
      <BackLink to="/my-bookings" label="Back to my bookings" />
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Booking status</h1>
          <p className="text-text-muted">
            {b.bookingDate} · {b.bookingType}
          </p>
        </div>
        <Badge tone={statusTone(b.status)}>{b.status}</Badge>
      </div>

      <Card title="Allocation">
        {b.status === 'ALLOCATED' && b.allocatedSlotNumber ? (
          <p className="text-text">
            Allocated slot <span className="font-semibold text-accent">{b.allocatedSlotNumber}</span>.
          </p>
        ) : (
          <p className="text-text-muted">No slot assigned ({b.status.toLowerCase()}).</p>
        )}
      </Card>

      <Card title="Score breakdown" description="How this request was scored.">
        {sb ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Row label="Distance" value={`${sb.distanceKm ?? '—'} km → ${sb.distanceScore.toFixed(1)}`} />
            <Row label="Carpool" value={`${sb.people} people → ${sb.carpoolScore.toFixed(1)}`} />
            <Row label="Weights" value={`distance ${sb.distanceWeight} · carpool ${sb.carpoolWeight}`} />
            <Row label="Final score" value={sb.finalScore.toFixed(1)} emphasize />
          </dl>
        ) : (
          <p className="text-text-muted">Not scored yet — available after allocation runs.</p>
        )}
      </Card>

      {b.carpoolMembers && b.carpoolMembers.length > 0 && (
        <Card title="Carpool members">
          <ul className="space-y-1.5 text-sm">
            {b.carpoolMembers.map((m, i) => (
              <li key={m.id ?? i} className="flex items-center gap-2">
                <span className="text-text">{m.name}</span>
                {m.employeeEmail && <span className="text-text-muted">{m.employeeEmail}</span>}
                {m.isScored && <Badge tone="success">scored</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(canEdit || canRelease) && (
        <div className="flex gap-2">
          {canEdit && (
            <Button variant="secondary" onClick={openEdit}>
              Edit booking
            </Button>
          )}
          {canRelease && (
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>
              Release slot
            </Button>
          )}
        </div>
      )}

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit booking"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button loading={update.isPending} onClick={onSaveEdit}>
              Save changes
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Vehicle type"
            placeholder="Select…"
            options={VEHICLE_TYPES}
            value={vehicleType}
            onChange={(e) => setVehicleType(e.target.value)}
          />
          <Input label="Vehicle number" value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} />
          <Input
            label="People (incl. you)"
            type="number"
            min={1}
            value={people}
            onChange={(e) => setPeople(e.target.value)}
            hint="Driver counts as person 1. Distance isn't editable — it's snapshotted from your profile."
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text">Carpool members</span>
              <Button type="button" size="sm" variant="secondary" disabled={members.length >= peopleNum - 1} onClick={addMember}>
                Add member
              </Button>
            </div>
            {members.length === 0 ? (
              <p className="text-xs text-text-muted">No members added.</p>
            ) : (
              members.map((m, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Input
                    aria-label={`Member ${i + 1} name`}
                    placeholder="Name"
                    value={m.name}
                    onChange={(e) => setMember(i, 'name', e.target.value)}
                  />
                  <Input
                    aria-label={`Member ${i + 1} email`}
                    placeholder="Employee email"
                    value={m.employeeEmail}
                    onChange={(e) => setMember(i, 'employeeEmail', e.target.value)}
                  />
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeMember(i)}>
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>

          <Input label="Special requirement" value={special} onChange={(e) => setSpecial(e.target.value)} />
          {editError && <p role="alert" className="text-sm text-danger">{editError}</p>}
        </div>
      </Modal>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Release your slot?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={release.isPending} onClick={onRelease}>
              Release
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-muted">
          Releasing frees your bay for the waitlist. This can't be undone for today.
        </p>
      </Modal>
    </div>
  );
}

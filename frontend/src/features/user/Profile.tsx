import { useEffect, useState, type FormEvent } from 'react';
import { Button, Card, ErrorState, Input, LoadingState, Select, useToast } from '../../components';
import {
  useCreateMyVehicle,
  useMe,
  useMyVehicles,
  useRemoveMyVehicle,
  useUpdateMe,
  useUpdateMyVehicle,
} from '../../api/hooks';
import { ApiError, apiErrorText } from '../../api/http';
import { BackLink } from '../shared/BackLink';
import type { components } from '../../api/types';

type VehicleSummary = components['schemas']['VehicleSummary'];

const VEHICLE_TYPE_OPTIONS = [
  { value: 'CAR', label: 'Car' },
  { value: 'EV_CAR', label: 'EV car' },
  { value: 'BIKE', label: 'Bike' },
];

function vehicleLabel(v: VehicleSummary) {
  return [v.displayNumber, v.makeModel, v.colour].filter(Boolean).join(' - ');
}

export function Profile() {
  const me = useMe();
  const vehicles = useMyVehicles();
  const updateMe = useUpdateMe();
  const createVehicle = useCreateMyVehicle();
  const updateVehicle = useUpdateMyVehicle();
  const removeVehicle = useRemoveMyVehicle();
  const { toast } = useToast();

  const [profile, setProfile] = useState({
    fullName: '',
    contactNumber: '',
    address: '',
    pinCode: '',
    distanceKm: '',
  });
  const [car, setCar] = useState({
    vehicleNumber: '',
    vehicleType: 'CAR',
    makeModel: '',
    colour: '',
  });
  const [profileError, setProfileError] = useState<string | null>(null);
  const [carError, setCarError] = useState<string | null>(null);
  /** The car currently being edited in place, if any — id plus its working copy. */
  const [editing, setEditing] = useState<{
    id: string;
    vehicleNumber: string;
    vehicleType: string;
    makeModel: string;
    colour: string;
  } | null>(null);

  useEffect(() => {
    if (!me.data) return;
    setProfile({
      fullName: me.data.fullName,
      contactNumber: me.data.contactNumber,
      address: me.data.address,
      pinCode: me.data.pinCode,
      distanceKm: me.data.distanceKm != null ? String(me.data.distanceKm) : '',
    });
  }, [me.data]);

  if (me.isLoading || vehicles.isLoading) return <LoadingState label="Loading profile..." />;
  if (me.isError || !me.data) return <ErrorState title="Couldn't load profile" />;

  function onProfileSubmit(event: FormEvent) {
    event.preventDefault();
    setProfileError(null);
    updateMe.mutate(
      {
        fullName: profile.fullName.trim(),
        contactNumber: profile.contactNumber.trim(),
        address: profile.address.trim(),
        pinCode: profile.pinCode.trim(),
        distanceKm: profile.distanceKm.trim() ? Number(profile.distanceKm) : null,
      },
      {
        onSuccess: () => toast('Profile updated.', { tone: 'success' }),
        onError: (err) => setProfileError(err instanceof ApiError ? (apiErrorText(err) ?? err.message) : 'Could not update profile.'),
      },
    );
  }

  function onCarSubmit(event: FormEvent) {
    event.preventDefault();
    setCarError(null);
    createVehicle.mutate(
      {
        vehicleNumber: car.vehicleNumber.trim(),
        vehicleType: car.vehicleType as VehicleSummary['vehicleType'],
        makeModel: car.makeModel.trim() || null,
        colour: car.colour.trim() || null,
      },
      {
        onSuccess: () => {
          setCar({ vehicleNumber: '', vehicleType: 'CAR', makeModel: '', colour: '' });
          toast('Car added.', { tone: 'success' });
        },
        onError: (err) => setCarError(err instanceof ApiError ? (apiErrorText(err) ?? err.message) : 'Could not add car.'),
      },
    );
  }

  /** Open the inline editor seeded from the saved row. `displayNumber` is the human form, so edit that. */
  function startEditCar(v: VehicleSummary) {
    setCarError(null);
    setEditing({
      id: v.id,
      vehicleNumber: v.displayNumber || v.vehicleNumber,
      vehicleType: v.vehicleType,
      makeModel: v.makeModel ?? '',
      colour: v.colour ?? '',
    });
  }

  function onEditCarSubmit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setCarError(null);
    const { id, ...values } = editing;
    updateVehicle.mutate(
      {
        id,
        vehicleNumber: values.vehicleNumber.trim(),
        vehicleType: values.vehicleType as VehicleSummary['vehicleType'],
        // Empty means "clear it", which the API models as null rather than an empty string.
        makeModel: values.makeModel.trim() || null,
        colour: values.colour.trim() || null,
      },
      {
        onSuccess: () => {
          setEditing(null);
          toast('Car updated.', { tone: 'success' });
        },
        onError: (err) =>
          setCarError(err instanceof ApiError ? (apiErrorText(err) ?? err.message) : 'Could not update car.'),
      },
    );
  }

  function onRemoveCar(id: string) {
    removeVehicle.mutate(id, {
      onSuccess: () => toast('Car removed.', { tone: 'success' }),
      onError: (err) => setCarError(err instanceof ApiError ? (apiErrorText(err) ?? err.message) : 'Could not remove car.'),
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <BackLink label="Back to home" />
        <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-text-muted">Manage your details and the cars security can identify at the gate.</p>
        </div>
      </div>

      <Card title="Personal information">
        <form className="space-y-4" onSubmit={onProfileSubmit}>
          {profileError && (
            <p role="alert" className="rounded-control border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">
              {profileError}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" value={profile.fullName} onChange={(e) => setProfile((p) => ({ ...p, fullName: e.target.value }))} />
            <Input label="Contact number" value={profile.contactNumber} onChange={(e) => setProfile((p) => ({ ...p, contactNumber: e.target.value }))} />
            <Input label="Address" value={profile.address} onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))} />
            <Input label="PIN code" value={profile.pinCode} onChange={(e) => setProfile((p) => ({ ...p, pinCode: e.target.value }))} />
            <Input
              label="Distance to office (km)"
              type="number"
              min={0}
              max={200}
              step="any"
              value={profile.distanceKm}
              onChange={(e) => setProfile((p) => ({ ...p, distanceKm: e.target.value }))}
            />
          </div>
          <Button type="submit" loading={updateMe.isPending}>
            Save profile
          </Button>
        </form>
      </Card>

      <Card title="Cars">
        <div className="space-y-5">
          {carError && (
            <p role="alert" className="rounded-control border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">
              {carError}
            </p>
          )}

          <form className="grid gap-4 lg:grid-cols-[1.1fr_0.8fr_0.8fr_0.7fr_auto]" onSubmit={onCarSubmit}>
            <Input label="Car number" value={car.vehicleNumber} onChange={(e) => setCar((c) => ({ ...c, vehicleNumber: e.target.value }))} />
            <Select
              label="Type"
              options={VEHICLE_TYPE_OPTIONS}
              value={car.vehicleType}
              onChange={(e) => setCar((c) => ({ ...c, vehicleType: e.target.value }))}
            />
            <Input label="Make/model" value={car.makeModel} onChange={(e) => setCar((c) => ({ ...c, makeModel: e.target.value }))} />
            <Input label="Colour" value={car.colour} onChange={(e) => setCar((c) => ({ ...c, colour: e.target.value }))} />
            <div className="flex items-end">
              <Button type="submit" loading={createVehicle.isPending} disabled={!car.vehicleNumber.trim()}>
                Add car
              </Button>
            </div>
          </form>

          {vehicles.data && vehicles.data.length > 0 ? (
            <ul className="divide-y divide-border rounded-control border border-border">
              {vehicles.data.map((v) =>
                editing?.id === v.id ? (
                  <li key={v.id} className="px-4 py-3">
                    <form
                      className="grid gap-4 lg:grid-cols-[1.1fr_0.8fr_0.8fr_0.7fr_auto]"
                      onSubmit={onEditCarSubmit}
                    >
                      <Input
                        label="Car number"
                        value={editing.vehicleNumber}
                        onChange={(e) => setEditing((c) => (c ? { ...c, vehicleNumber: e.target.value } : c))}
                      />
                      <Select
                        label="Type"
                        options={VEHICLE_TYPE_OPTIONS}
                        value={editing.vehicleType}
                        onChange={(e) => setEditing((c) => (c ? { ...c, vehicleType: e.target.value } : c))}
                      />
                      <Input
                        label="Make/model"
                        value={editing.makeModel}
                        onChange={(e) => setEditing((c) => (c ? { ...c, makeModel: e.target.value } : c))}
                      />
                      <Input
                        label="Colour"
                        value={editing.colour}
                        onChange={(e) => setEditing((c) => (c ? { ...c, colour: e.target.value } : c))}
                      />
                      <div className="flex items-end gap-2">
                        <Button
                          type="submit"
                          size="sm"
                          loading={updateVehicle.isPending}
                          disabled={!editing.vehicleNumber.trim()}
                        >
                          Save car
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  </li>
                ) : (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="font-medium text-text">{v.displayNumber}</p>
                      <p className="text-sm text-text-muted">{vehicleLabel(v) || v.vehicleNumber}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Edit ${v.displayNumber}`}
                        onClick={() => startEditCar(v)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Remove ${v.displayNumber}`}
                        loading={removeVehicle.isPending}
                        onClick={() => onRemoveCar(v.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  </li>
                ),
              )}
            </ul>
          ) : (
            <p className="text-sm text-text-muted">No cars saved yet.</p>
          )}
        </div>
      </Card>
    </div>
  );
}

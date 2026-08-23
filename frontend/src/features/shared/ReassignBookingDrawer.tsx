import { useMemo, useState } from 'react';
import { Button, Drawer, Input, Select, useToast } from '../../components';
import { useCompanyUsers, useReassignBooking } from '../../api/hooks';
import { ApiError } from '../../api/http';
import type { components } from '../../api/types';

type AdminBooking = components['schemas']['AdminBooking'];

export interface ReassignBookingDrawerProps {
  /** The allocated booking being handed over. */
  booking: AdminBooking;
  onClose: () => void;
  /** The acting admin's company — the only pool the taker can come from. */
  companyId: string | undefined;
}

/** Enough to cover any single tenant's active headcount in this POC without paging the picker. */
const USER_PAGE_SIZE = 100;

/**
 * Hand an allocated slot to a colleague — the Slack swap, made official.
 *
 * The flow this exists for: someone posts that they are not coming in, someone else says they will take
 * the slot, and the admin records it here instead of the bay quietly going unused. Deliberately NOT the
 * same thing as Release, which is one click away in the same dialog: release hands the slot to whoever
 * the waitlist cascade picks, which is exactly what you do *not* want when a named person already
 * asked for it.
 *
 * The car number is the field people skip and shouldn't. The gate matches an arriving plate to today's
 * booking, so until it changes the guard is still looking for the person who stayed home.
 */
export function ReassignBookingDrawer({ booking, onClose, companyId }: ReassignBookingDrawerProps) {
  const colleagues = useCompanyUsers(companyId, 1, USER_PAGE_SIZE, 'ACTIVE');
  const reassign = useReassignBooking();
  const { toast } = useToast();

  // No reset effect: the parent mounts this only while a handover is open, so every opening starts on
  // fresh state and a previous booking's typed reason can never be submitted against another row.
  const [toUserId, setToUserId] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [reason, setReason] = useState('');

  /**
   * The current holder is filtered out rather than left in and rejected server-side: picking the person
   * who already has the slot is never a thing the admin meant to do.
   *
   * The placeholder distinguishes "still loading" from "genuinely nobody". They look identical from an
   * empty list, and showing "No other active colleagues" for the second or two the fetch takes reads as
   * *there is nobody to hand this to* — the opposite of the truth, on the one screen where the admin is
   * trying to find somebody.
   */
  const options = useMemo(() => {
    const rows = (colleagues.data?.items ?? [])
      .filter((u) => u.email !== booking.employeeEmail)
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    const placeholder = colleagues.isLoading
      ? 'Loading colleagues…'
      : colleagues.isError
        ? 'Could not load colleagues'
        : rows.length
          ? 'Pick a colleague…'
          : 'No other active colleagues';
    return [
      { value: '', label: placeholder },
      ...rows.map((u) => ({ value: u.id, label: `${u.fullName} — ${u.email}` })),
    ];
  }, [colleagues.data, colleagues.isLoading, colleagues.isError, booking.employeeEmail]);

  const taker = colleagues.data?.items.find((u) => u.id === toUserId);

  function submit() {
    if (!toUserId) return;
    reassign.mutate(
      {
        id: booking.id,
        toUserId,
        ...(vehicleNumber.trim() ? { vehicleNumber: vehicleNumber.trim() } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      },
      {
        onSuccess: () => {
          const slot = booking.allocatedSlotNumber ? `Slot ${booking.allocatedSlotNumber}` : 'The slot';
          toast(`${slot} on ${booking.bookingDate} now belongs to ${taker?.fullName ?? 'them'}.`, {
            tone: 'success',
          });
          onClose();
        },
      },
    );
  }

  const errorMsg =
    reassign.error instanceof ApiError
      ? reassign.error.message
      : reassign.isError
        ? 'Something went wrong. Please try again.'
        : null;

  return (
    <Drawer
      open
      onClose={onClose}
      title="Hand this slot to a colleague"
      description={`${booking.employeeName} is not coming on ${booking.bookingDate}. The booking moves to whoever is taking their place — same slot, same date.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={reassign.isPending} disabled={!toUserId}>
            Hand over the slot
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

        <dl className="grid grid-cols-2 gap-3 rounded-control bg-surface-2 px-3 py-2 text-sm">
          <div>
            <dt className="text-xs uppercase text-text-muted">Currently held by</dt>
            <dd className="mt-0.5 font-medium">{booking.employeeName}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-text-muted">Slot</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{booking.allocatedSlotNumber ?? '-'}</dd>
          </div>
        </dl>

        <Select
          label="Taking the slot"
          options={options}
          value={toUserId}
          onChange={(e) => setToUserId(e.target.value)}
          disabled={colleagues.isLoading}
          hint={
            colleagues.isError
              ? "Couldn't load the employee list — reopen this panel to retry."
              : 'Anyone active in your company who does not already have a slot that day.'
          }
        />

        <Input
          label="Car number"
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="Leave blank to use their registered car"
          value={vehicleNumber}
          onChange={(e) => setVehicleNumber(e.target.value)}
          hint="The gate looks the arriving car up against this booking, so a car nobody has registered needs typing in here."
        />

        <Input
          label="Why (optional)"
          autoComplete="off"
          placeholder="e.g. swapped on #parking after Aditi went WFH"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint="Kept on the booking and in the audit log — worth a line when someone asks later."
        />

        <p className="text-sm text-text-muted">
          The colleague&apos;s own request for this date, if they had one, is replaced by this slot. Their
          declared carpool starts empty.
        </p>
      </div>
    </Drawer>
  );
}

import { useEffect, useState } from 'react';
import { Badge, Button, Drawer, Input, Spinner, useToast } from '../../components';
import { useGateCheckIn, useGateCheckOut, useVehicleLookup, useVehicleSearch } from '../../api/hooks';
import { ApiError } from '../../api/http';
import { cn } from '../../lib/cn';
import { normalizePlate } from '../../lib/plate';

export type GateMode = 'CHECK_IN' | 'CHECK_OUT';

export interface GateDrawerProps {
  mode: GateMode | null;
  onClose: () => void;
}

const timeOnly = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * The security persona's one interaction (Phase 7 §5): type a car number, see who it is, submit.
 *
 * The driver's details are looked up from the registry as the number is typed — the guard never types
 * a name. An unknown plate, or a known one with no booking today, is still submittable (D16): the
 * barrier must never be blocked by this screen. The warning is informational, and the entry is
 * flagged for the company admin to follow up.
 */
export function GateDrawer({ mode, onClose }: GateDrawerProps) {
  const [number, setNumber] = useState('');
  const { toast } = useToast();

  const suggestions = useVehicleSearch(number);
  const lookup = useVehicleLookup(number);
  const checkIn = useGateCheckIn();
  const checkOut = useGateCheckOut();

  // Reset between openings so the previous car's details never linger on a fresh visit.
  useEffect(() => {
    if (mode) {
      setNumber('');
      checkIn.reset();
      checkOut.reset();
    }
    // `checkIn`/`checkOut` are stable mutation objects; re-running on their identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const isCheckIn = mode === 'CHECK_IN';
  const mutation = isCheckIn ? checkIn : checkOut;
  const found = lookup.data;
  const tooShort = number.trim().length < 4;

  /**
   * Is the typed text a *fragment* of a real plate rather than a plate?
   *
   * The two queries behind this drawer answer different questions: the typeahead matches a SUBSTRING
   * (`vehicleNumber contains`), while the lookup matches the plate EXACTLY. So typing `7777` when
   * `MH15LM7777` is registered legitimately produces a suggestion AND `known: false` — and the drawer
   * used to render both, contradicting itself: "registered to Assent user 1" directly above "Not in the
   * vehicle registry". Worse, Confirm stayed live, so an unfinished keystroke could be recorded as a
   * real visit against the plate `7777`.
   *
   * The registry containing cars that *contain* the input, but none that *equal* it, is exactly the
   * signal that the guard has not finished typing.
   */
  const typedPlate = normalizePlate(number);
  const suggestionList = suggestions.data ?? [];
  const looksLikePrefix =
    !tooShort &&
    !found?.known &&
    suggestionList.length > 0 &&
    !suggestionList.some((v) => v.vehicleNumber === typedPlate);

  function submit() {
    if (tooShort) return;
    mutation.mutate(
      { vehicleNumber: number.trim() },
      {
        onSuccess: (event) => {
          toast(
            isCheckIn
              ? event.hadBooking
                ? `Checked in ${event.displayNumber}.`
                : `Checked in ${event.displayNumber} — no booking today, flagged for the company admin.`
              : `Checked out ${event.displayNumber}.`,
            { tone: isCheckIn && !event.hadBooking ? 'warning' : 'success' },
          );
          onClose();
        },
      },
    );
  }

  const errorMsg =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.isError
        ? 'Something went wrong. Please try again.'
        : null;

  return (
    <Drawer
      open={mode !== null}
      onClose={onClose}
      title={isCheckIn ? 'Check in' : 'Check out'}
      description="Enter the car number — the driver's details are filled in automatically."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending} disabled={tooShort}>
            {isCheckIn ? 'Confirm check in' : 'Confirm check out'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {errorMsg && (
          <p role="alert" className="rounded-control border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">
            {errorMsg}
          </p>
        )}

        <Input
          label="Car number"
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="MH 12 AB 1234"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          hint="Spacing and case do not matter."
        />

        {/* Registry suggestions — tapping one is faster and safer than typing the whole plate. */}
        {!tooShort && suggestions.data && suggestions.data.length > 0 && !found?.known && (
          <ul className="divide-y divide-border rounded-control border border-border">
            {suggestions.data.slice(0, 6).map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setNumber(v.vehicleNumber)}
                  className="flex w-full flex-col items-start px-3 py-2 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="text-sm font-medium text-text">{v.displayNumber}</span>
                  <span className="text-xs text-text-muted">
                    {v.ownerName}
                    {v.companyName ? ` · ${v.companyName}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {lookup.isFetching && (
          <p className="flex items-center gap-2 text-sm text-text-muted">
            <Spinner /> Looking up…
          </p>
        )}

        {/* An unfinished plate gets a prompt, never a verdict — see `looksLikePrefix`. Deliberately not
            disabling Confirm: the barrier must never be blocked (D16), so this warns about what would be
            recorded and points at the suggestions instead of refusing. */}
        {looksLikePrefix && (
          <p
            role="status"
            className="rounded-control border border-warning/30 bg-warning-subtle px-3 py-2 text-sm text-warning"
          >
            <span className="font-medium">{typedPlate}</span> is not a full car number — pick the car above,
            or keep typing. Confirming now would record the visit against “{typedPlate}” as typed.
          </p>
        )}

        {found && !looksLikePrefix && (
          <div className="space-y-3 rounded-control border border-border bg-surface-2/50 p-4">
            {/* `known` and `hasBooking` are independent, and this panel must not conflate them. An
                unregistered plate can still carry today's booking (matched on the number typed onto the
                booking), and that booking names the driver and their slot. Hiding all of it behind
                "not in the registry" is what made a booked arrival look like a stranger to the guard. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-text">
                {found.vehicle?.displayNumber ?? found.vehicleNumber}
              </p>
              <Badge tone={found.hasBooking ? 'success' : 'warning'}>
                {found.hasBooking ? 'Booked today' : 'No booking today'}
              </Badge>
            </div>

            {(() => {
              // Registry first (it is the richer, curated record), then the booking.
              const driver = found.vehicle?.ownerName ?? found.booking?.employeeName ?? null;
              const company = found.vehicle?.companyName ?? found.booking?.companyName ?? null;
              const contact = found.vehicle?.contactNumber ?? found.booking?.contactNumber ?? null;
              const description = [found.vehicle?.makeModel, found.vehicle?.colour].filter(Boolean).join(' · ');
              const slot = found.booking?.allocatedSlotNumber ?? null;
              if (!driver && !company && !contact && !description && !slot) return null;
              return (
                <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-sm">
                  {driver && (
                    <>
                      <dt className="text-text-muted">Driver</dt>
                      <dd className="text-text">{driver}</dd>
                    </>
                  )}
                  {company && (
                    <>
                      <dt className="text-text-muted">Company</dt>
                      <dd className="text-text">{company}</dd>
                    </>
                  )}
                  {contact && (
                    <>
                      <dt className="text-text-muted">Contact</dt>
                      <dd className="text-text">{contact}</dd>
                    </>
                  )}
                  {description && (
                    <>
                      <dt className="text-text-muted">Vehicle</dt>
                      <dd className="text-text">{description}</dd>
                    </>
                  )}
                  {slot && (
                    <>
                      <dt className="text-text-muted">Slot</dt>
                      <dd className="font-medium text-text">{slot}</dd>
                    </>
                  )}
                </dl>
              );
            })()}

            {/* Still worth saying — it explains why there is no car description, and tells the guard the
                plate is worth adding to the registry. Now a footnote, not a replacement for the facts. */}
            {!found.known && (
              <p className="text-sm text-warning">
                {found.hasBooking
                  ? 'Not in the vehicle registry — matched by the number on the booking.'
                  : 'Not in the vehicle registry.'}
              </p>
            )}

            {/* Never a blocker — say plainly what will be recorded, then let the guard proceed. */}
            {isCheckIn && !found.hasBooking && (
              <p role="status" className="text-sm text-warning">
                No parking booking for today. You can still let them in — the entry is recorded and the company
                admin is notified.
              </p>
            )}
            {isCheckIn && found.openVisit && (
              <p role="status" className="text-sm text-danger">
                Already checked in at {timeOnly(found.openVisit.checkInAt)} — check the car out first.
              </p>
            )}
            {!isCheckIn && !found.openVisit && (
              <p role="status" className="text-sm text-warning">
                This car is not currently checked in.
              </p>
            )}
            {!isCheckIn && found.openVisit && (
              <p className={cn('text-sm text-text-muted')}>
                Checked in at {timeOnly(found.openVisit.checkInAt)}.
              </p>
            )}
          </div>
        )}

        {!tooShort && lookup.isError && (
          <p className="text-sm text-text-muted">
            Could not look that number up. You can still record the entry.
          </p>
        )}
      </div>
    </Drawer>
  );
}

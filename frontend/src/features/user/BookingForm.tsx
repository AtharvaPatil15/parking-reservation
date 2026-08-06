import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFieldArray, useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Badge,
  Button,
  Card,
  Input,
  LoadingState,
  ErrorState,
  SuccessState,
  SlotCount,
  buttonClasses,
} from '../../components';
import { useAvailability, useCreateBookings, useMe, useMyVehicles } from '../../api/hooks';
import { ApiError, apiErrorText } from '../../api/http';
import { useCountdown } from '../../lib/useCountdown';
import { cn } from '../../lib/cn';
import { BackLink } from '../shared/BackLink';
import { bookingSchema, MAX_BOOKING_DATES, type BookingFormValues } from './bookingSchema';
import { formatCountdown } from '../../lib/dates';
import type { components } from '../../api/types';

type DayAvailability = components['schemas']['DayAvailability'];
type BookingBatchResult = components['schemas']['BookingBatchResult'];

/** Escalate the run countdown to a warning tone inside the final day. */
const FINAL_WINDOW_SECONDS = 24 * 60 * 60;

const dayLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

const runLabel = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Per-date status line (D18/D22): while OPEN this is a demand count, never a fullness readout — a
 * request never consumes a box, so "requests so far" is the honest word, not "free". Once DECIDED it
 * reports what was actually allocated.
 */
function dayStatusLine(day: DayAvailability): string {
  if (day.phase === 'DECIDED') {
    const blockedSuffix = day.blocked > 0 ? ` · ${day.blocked} blocked` : '';
    return `${day.allocatedCount} of ${day.quota} allocated${blockedSuffix}`;
  }
  return `${day.quota} slots · ${day.requestCount} request${day.requestCount === 1 ? '' : 's'} so far`;
}

/**
 * Book slots (Phase 8, D18/D22). The user picks one or more dates inside the rolling window and sees
 * how full each date is before committing. A request never consumes capacity — it is a queue entry,
 * scored and ranked at the weekly run, not a reservation. There is therefore no "date is full" refusal:
 * a date is only unpickable when it is outside the window, already decided, or already requested.
 *
 * Multi-date: the trip details below apply to every selected date, and each date is booked
 * independently. The outcome panel reports per date what happened; a date that turns out to already be
 * decided or duplicate does not cost the user the others.
 */
function scoreComponents(
  distanceKm: number,
  people: number,
  scoring: { distanceWeight: number; carpoolWeight: number; maxDistanceKm: number; maxPeople: number },
): { distanceScore: number; carpoolScore: number; finalScore: number } {
  const distanceScore = (Math.min(distanceKm, scoring.maxDistanceKm) / scoring.maxDistanceKm) * 100;
  const carpoolScore =
    scoring.maxPeople > 1 ? ((Math.min(people, scoring.maxPeople) - 1) / (scoring.maxPeople - 1)) * 100 : 0;
  const finalScore = scoring.distanceWeight * distanceScore + scoring.carpoolWeight * carpoolScore;
  return { distanceScore, carpoolScore, finalScore };
}
export function BookingForm() {
  const me = useMe();
  const vehicles = useMyVehicles();
  const availability = useAvailability();
  const createBookings = useCreateBookings();

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    setError,
    reset,
    formState: { errors },
  } = useForm<BookingFormValues>({
    resolver: zodResolver(bookingSchema),
    defaultValues: { bookingDates: [], carpoolPeople: 1, carpoolMembers: [] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'carpoolMembers' });
  const carpoolPeople = Number(watch('carpoolPeople')) || 1;
  const carpoolMembers = watch('carpoolMembers') ?? [];
  /**
   * People the *run* will score, which is not the same as `carpoolPeople`. The server counts
   * `1 + members whose email resolves to an active colleague`, so a declared "4 people" with no member
   * rows scores as 1. Scoring the typed number instead would show the user a number they were never
   * ranked on — worse than showing none. Still an estimate: only the server can tell whether an email
   * actually resolves, so this counts rows that at least carry one.
   */
  const scoredPeople = 1 + carpoolMembers.filter((m) => m?.employeeEmail?.trim()).length;
  const bookingDates = watch('bookingDates') ?? [];
  const selectedDates = new Set(bookingDates);

  /**
   * Which date's detail panel is on show. Separate from the selection: with several dates picked
   * there is no single "the" date, so the panel follows whichever row was touched last. Clicking a
   * row both toggles it and brings its counts up, so one click still answers "how full is that day?".
   */
  const [focusedDate, setFocusedDate] = useState<string | null>(null);

  const window_ = availability.data?.window;
  // Weekends are in the payload for completeness but are never bookable (D7) — leave them out.
  const days: DayAvailability[] = (availability.data?.days ?? []).filter((d) => d.reason !== 'NOT_WEEKDAY');
  const openDates = days.filter((d) => d.requestable).map((d) => d.date);
  const focused = days.find((d) => d.date === focusedDate) ?? days.find((d) => d.date === bookingDates[0]);

  // Land on the first date the user can actually book rather than an arbitrary "tomorrow". Only while
  // the user has not touched the selection — re-adding a date they deliberately cleared would fight them.
  const firstOpen = openDates[0];
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched && bookingDates.length === 0 && firstOpen) {
      setValue('bookingDates', [firstOpen], { shouldValidate: false });
      setFocusedDate(firstOpen);
    }
  }, [touched, bookingDates.length, firstOpen, setValue]);

  /** Toggle a date in/out of the selection, and show its detail panel either way. */
  function toggleDate(date: string): void {
    setTouched(true);
    setFocusedDate(date);
    const next = selectedDates.has(date)
      ? bookingDates.filter((d) => d !== date)
      : [...bookingDates, date].sort();
    setValue('bookingDates', next, { shouldValidate: bookingDates.length > 0 });
  }

  const allOpenSelected = openDates.length > 0 && openDates.every((d) => selectedDates.has(d));
  function selectAllOpen(): void {
    setTouched(true);
    // Slice to the server's cap so "select all" can never build a request the API would refuse.
    setValue('bookingDates', openDates.slice(0, MAX_BOOKING_DATES), { shouldValidate: true });
  }
  function clearDates(): void {
    setTouched(true);
    setValue('bookingDates', [], { shouldValidate: true });
  }

  const secondsLeft = useCountdown(window_?.nextRunCountdownSeconds);
  const runUrgent = secondsLeft != null && secondsLeft > 0 && secondsLeft <= FINAL_WINDOW_SECONDS;

  if (me.isLoading || availability.isLoading || vehicles.isLoading) return <LoadingState label="Loading booking form…" />;
  if (availability.isError) {
    return (
      <ErrorState
        description="Could not load slot availability."
        action={
          <Button variant="secondary" size="sm" onClick={() => availability.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  // The batch resolves with a per-date report even when some (or all) dates failed, so this screen
  // covers all three shapes: everything booked, a partial set, and nothing at all.
  if (createBookings.isSuccess) {
    const { results, createdCount, failedCount, requested } = createBookings.data;
    const bookAgain = () => {
      createBookings.reset();
      // Keep the trip details; drop the dates so the user starts from a fresh selection.
      reset({ bookingDates: [], carpoolPeople, carpoolMembers: [] });
      setTouched(false);
      setFocusedDate(null);
    };
    return (
      <div className="space-y-4">
        {failedCount === 0 ? (
          <SuccessState
            title={createdCount === 1 ? 'Request queued' : `${createdCount} requests queued`}
            description={
              window_
                ? // D19: the copy must say "queued", never "held" — a user who thinks they hold a slot and
                  // then gets waitlisted is the failure mode this phase exists to prevent.
                  `${createdCount} request${createdCount === 1 ? '' : 's'} queued. Results are published ` +
                  `${runLabel(window_.nextRunAt)} — you'll be told which dates you got at least ` +
                  `${window_.approvalLeadDays} day${window_.approvalLeadDays === 1 ? '' : 's'} before each date.`
                : `${createdCount} request${createdCount === 1 ? '' : 's'} queued.`
            }
          />
        ) : (
          <div
            role={createdCount === 0 ? 'alert' : 'status'}
            className={cn(
              'rounded-control border px-4 py-3',
              createdCount === 0
                ? 'border-danger/30 bg-danger-subtle text-danger'
                : 'border-warning/30 bg-warning-subtle text-warning',
            )}
          >
            <p className="font-medium">
              {createdCount === 0
                ? 'No dates could be queued'
                : `${createdCount} of ${requested} dates queued`}
            </p>
            <p className="mt-1 text-sm">
              {createdCount === 0
                ? 'Nothing was submitted — see the reasons below and try different dates.'
                : 'The rest could not be queued. The dates that worked are already queued for you.'}
            </p>
          </div>
        )}

        <Card title="What happened" padded={false}>
          <ul className="divide-y divide-border">
            {results.map((r: BookingBatchResult) => (
              <li key={r.bookingDate} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="text-sm font-medium text-text">{dayLabel(r.bookingDate)}</span>
                {r.outcome === 'CREATED' ? (
                  <span className="flex items-center gap-3">
                    <Badge tone="success">Submitted</Badge>
                    {r.booking && (
                      <Link to={`/booking/${r.booking.id}`} className="text-sm text-primary hover:underline">
                        View status
                      </Link>
                    )}
                  </span>
                ) : (
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    <Badge tone="warning">Not booked</Badge>
                    <span className="text-sm text-text-muted">{r.message}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>

        {/* Stacked and full-width on a phone so both actions are comfortable tap targets. The
            dashboard action is a styled Link, not a Button inside a Link — that would nest
            <button> inside <a>, which is invalid and confuses screen readers. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link to="/app" className={buttonClasses('primary', 'md', 'w-full sm:w-auto')}>
            Go to dashboard
          </Link>
          <Button variant="secondary" className="w-full sm:w-auto" onClick={bookAgain}>
            Book more dates
          </Button>
        </div>
      </div>
    );
  }

  /**
   * Only genuine request-level failures land here now: a 400 (bad payload / unknown carpool member),
   * auth, or the network. Per-date refusals — full, duplicate, window closed — come back inside a
   * successful batch and are shown in the outcome panel above, not as a banner.
   */
  const err = createBookings.error;
  // A 400 with field `details` (e.g. an unknown carpool-member email) is shown inline on the offending
  // field, so suppress the generic banner for it.
  const isFieldError = err instanceof ApiError && err.status === 400 && Boolean(err.details?.length);
  const errorMsg =
    createBookings.isError && !isFieldError
      ? err instanceof ApiError
        ? (apiErrorText(err) ?? err.message)
        : 'Something went wrong. Please try again.'
      : null;

  // Every selected date must still be bookable. The rows only allow requestable dates to be picked, so
  // this catches a window that went stale under the user rather than an invalid click.
  const unbookableSelected = bookingDates.filter((d) => !openDates.includes(d));
  const submitBlocked = bookingDates.length === 0 || unbookableSelected.length > 0;
  const savedCars = vehicles.data ?? [];

  const onSubmit = handleSubmit((values) => {
    createBookings.mutate(
      {
        bookingDates: values.bookingDates,
        // Demo simplification: the UI only offers car bookings. The API/enum still accepts BIKE/EV_CAR,
        // so this is a client-side narrowing, not a contract change — the picker can be restored later.
        vehicleType: 'CAR',
        vehicleNumber: values.vehicleNumber || undefined,
        carpoolPeople: Number(values.carpoolPeople),
        // Email is required by the schema, so pass it through unchanged (no `|| undefined`).
        carpoolMembers: values.carpoolMembers?.map((m) => ({ name: m.name, employeeEmail: m.employeeEmail })),
      },
      {
        onSuccess: (data) => {
          // Any date that failed means the counts on screen were stale — pull the truth back so the
          // "book more dates" pass starts from real numbers.
          if (data.failedCount > 0) availability.refetch();
        },
        onError: (e) => {
          // Map server-side member validation (unknown emails) back onto each field.
          if (e instanceof ApiError && e.status === 400 && e.details?.length) {
            for (const d of e.details) setError(d.field as FieldPath<BookingFormValues>, { message: d.message });
          }
        },
      },
    );
  });

  return (
    // Left-aligned like every other screen (the shell no longer centres content),
    // but the form keeps a readable measure rather than stretching to a wide monitor.
    <div className="space-y-5">
      <div className="space-y-3">
        <BackLink />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-4xl">Book a parking slot</h1>
            <p className="text-text-muted">
              Home → office: {me.data?.distanceKm != null ? `${me.data.distanceKm} km` : 'not set'} · used in scoring.
            </p>
          </div>
          {window_ && (
            <span
              {...(runUrgent ? { role: 'status' } : {})}
              className={cn(
                'inline-flex flex-col rounded-control border px-3 py-1.5 text-sm',
                runUrgent
                  ? 'border-warning/30 bg-warning-subtle text-warning'
                  : 'border-border bg-surface text-text-muted',
              )}
            >
              <span>Results published {runLabel(window_.nextRunAt)}</span>
              {secondsLeft != null && secondsLeft > 0 && (
                <span className="font-medium tabular-nums">in {formatCountdown(secondsLeft)}</span>
              )}
            </span>
          )}
        </div>
        {window_ && (
          <p className="text-sm text-text-muted">
            Booking is open for the next {window_.windowWeeks} weeks ({dayLabel(window_.earliestDate)} –{' '}
            {dayLabel(window_.latestDate)}). Every date is decided at least {window_.approvalLeadDays} days ahead, so
            you have time to arrange another way in if a day fills up.
          </p>
        )}
      </div>

      {/* Window overview — pick as many dates as you need. Demand is a count, never a fullness gate
          (D18/D22): nothing here blocks a submission because a day "looks busy". */}
      <Card>
        <div className="space-y-3">
          <div className="space-y-0.5">
            <h2 className="text-sm font-medium text-text">Choose your dates</h2>
            <p className="text-xs text-text-muted">
              Pick one or more — the details below apply to every date you select. Requests are ranked
              by score (distance + carpool size) at the weekly run, not first-come-first-served —
              submitting early does not improve your chances.
            </p>
          </div>

          {openDates.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={allOpenSelected}
                onClick={selectAllOpen}
              >
                Select all {Math.min(openDates.length, MAX_BOOKING_DATES)} open dates
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={bookingDates.length === 0}
                onClick={clearDates}
              >
                Clear
              </Button>
              <span role="status" className="text-xs text-text-muted">
                {bookingDates.length === 0
                  ? 'No dates selected'
                  : `${bookingDates.length} date${bookingDates.length === 1 ? '' : 's'} selected`}
              </span>
            </div>
          )}

          {days.length === 0 ? (
            <p className="text-sm text-text-muted">No dates are open for booking right now.</p>
          ) : (
            <ul className="divide-y divide-border">
              {days.map((day) => {
                const isSelected = selectedDates.has(day.date);
                return (
                  <li key={day.date}>
                    {/* role=checkbox (not aria-pressed) because these are now independent, multi-select
                        choices rather than one toggle group — screen readers announce it accordingly. */}
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isSelected}
                      disabled={!day.requestable}
                      onClick={() => toggleDate(day.date)}
                      className={cn(
                        'flex w-full flex-wrap items-center justify-between gap-3 rounded-control px-2 py-2.5 text-left transition-colors',
                        day.requestable ? 'hover:bg-surface-2' : 'cursor-not-allowed opacity-60',
                        isSelected && 'bg-primary-subtle',
                        day.date === focusedDate && 'ring-1 ring-inset ring-primary/40',
                      )}
                    >
                      <span className="flex min-w-[9rem] items-center gap-2.5">
                        {/* A tick box makes multi-select obvious without relying on the row tint. */}
                        <span
                          aria-hidden="true"
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center  border text-[10px] font-bold leading-none',
                            isSelected
                              ? 'border-primary bg-primary text-white'
                              : 'border-border bg-surface text-transparent',
                          )}
                        >
                          ✓
                        </span>
                        <span className="flex flex-col">
                          <span className="text-sm font-medium text-text">{dayLabel(day.date)}</span>
                          {/* The row grid used to carry the caller's own slot number in its MINE box.
                              With counts in its place it has to be said in words, and it belongs here
                              rather than in the detail panel below: an allocated date is never
                              requestable (`reason = ALREADY_BOOKED`), so it can never be focused. It
                              sits above the server's own message rather than replacing it — the message
                              explains why the row is disabled, which the slot number does not. */}
                          {day.mySlotNumber && (
                            <span className="text-xs text-primary">You got slot {day.mySlotNumber}</span>
                          )}
                          <span className="text-xs text-text-muted">
                            {day.requestable ? dayStatusLine(day) : (day.message ?? 'Not available')}
                          </span>
                        </span>
                      </span>
                      <SlotCount boxes={day.boxes} size="sm" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <form className="space-y-5" onSubmit={onSubmit} noValidate>
          {errorMsg && (
            <p role="alert" className="rounded-control border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">
              {errorMsg}
            </p>
          )}

          {focused && (
            <div className="space-y-2 rounded-control border border-border bg-surface-2/50 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-text">
                  {dayLabel(focused.date)}
                  {selectedDates.has(focused.date) && (
                    <span className="ml-2 text-xs font-normal text-primary">selected</span>
                  )}
                </p>
                <p className="text-sm text-text-muted">{dayStatusLine(focused)}</p>
              </div>
              <SlotCount boxes={focused.boxes} />
              {!focused.requestable && focused.message && (
                <p role="status" className="text-sm text-warning">
                  {focused.message}
                </p>
              )}
            </div>
          )}

          {/* The full selection, so a user who scrolled away from the list still knows what they are
              about to book. */}
          {bookingDates.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-text-muted">Booking:</span>
              {bookingDates.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDate(d)}
                  // Explicit label: the visible text is just the date, so without this the button would
                  // announce as "Tue, 6 Jan" and give no hint that activating it removes the date.
                  aria-label={`Remove ${dayLabel(d)}`}
                  title={`Remove ${dayLabel(d)}`}
                  className="inline-flex items-center gap-1 border border-border bg-surface px-2.5 py-1 text-xs text-text hover:bg-surface-2"
                >
                  {dayLabel(d)}
                  <span aria-hidden="true" className="text-text-muted">
                    ×
                  </span>
                </button>
              ))}
            </div>
          )}

          {unbookableSelected.length > 0 && (
            <p role="alert" className="text-sm text-danger">
              {unbookableSelected.map(dayLabel).join(', ')} {unbookableSelected.length === 1 ? 'is' : 'are'} no
              longer available — remove {unbookableSelected.length === 1 ? 'it' : 'them'} to continue.
            </p>
          )}
          {errors.bookingDates?.message && <p className="text-sm text-danger">{errors.bookingDates.message}</p>}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Input
                label="Car number"
                list={savedCars.length > 0 ? 'profile-cars' : undefined}
                {...register('vehicleNumber')}
                error={errors.vehicleNumber?.message}
                hint={savedCars.length > 0 ? 'Choose a saved car or type another number.  (EX-MH14AB1234)' : 'Optional - helps security match you at the gate.'}
              />
              {savedCars.length > 0 && (
                <datalist id="profile-cars">
                  {savedCars.map((v) => (
                    <option key={v.id} value={v.vehicleNumber}>
                      {[v.displayNumber, v.makeModel, v.colour].filter(Boolean).join(' - ')}
                    </option>
                  ))}
                </datalist>
              )}
            </div>
            <Input
              label="Carpool people"
              type="number"
              min={1}
              max={4}
              hint="Including you (1–4)."
              {...register('carpoolPeople')}
              error={errors.carpoolPeople?.message}
            />
          </div>

          {/* Live score panel (§4, D3): recomputes client-side as carpool members are added/removed, so
              the user sees the same number the weekly run will score them on, with no round-trip. It
              scores `scoredPeople`, not the declared headcount — see the note on that value. */}
          {window_?.scoring &&
            (me.data?.distanceKm != null ? (
              (() => {
                const { distanceScore, carpoolScore, finalScore } = scoreComponents(
                  me.data.distanceKm,
                  scoredPeople,
                  window_.scoring,
                );
                return (
                  <div role="status" className="space-y-0.5" data-testid="score-panel">
                    <p className="text-sm text-text-muted">
                      Estimated score:{' '}
                      <span className="font-medium text-text">{finalScore.toFixed(1)}</span> —{' '}
                      {me.data.distanceKm} km ({distanceScore.toFixed(1)}) + {scoredPeople}{' '}
                      {scoredPeople === 1 ? 'person' : 'people'} ({carpoolScore.toFixed(1)})
                    </p>
                    <p className="text-xs text-text-muted">
                      Only colleagues we recognise from their work email count towards your carpool score
                      — add them below.
                    </p>
                  </div>
                );
              })()
            ) : (
              <p className="text-sm text-text-muted">
                Set your home → office distance in your profile to see your score.
              </p>
            ))}

          <fieldset className="space-y-3 border-t border-border pt-5">
            <div className="space-y-1">
              <legend className="text-sm font-medium text-text">Carpool members (optional)</legend>
              <p className="text-xs text-text-muted">
                Each member must be a registered user (any company). Enter their work email.
              </p>
            </div>
            {fields.map((f, i) => (
              <div key={f.id} className="flex items-start gap-2">
                <div className="flex-1">
                  <Input
                    aria-label={`Member ${i + 1} name`}
                    placeholder="Name"
                    {...register(`carpoolMembers.${i}.name`)}
                    error={errors.carpoolMembers?.[i]?.name?.message}
                  />
                </div>
                <div className="flex-1">
                  <Input
                    aria-label={`Member ${i + 1} email`}
                    placeholder="Employee email"
                    {...register(`carpoolMembers.${i}.employeeEmail`)}
                    error={errors.carpoolMembers?.[i]?.employeeEmail?.message}
                  />
                </div>
                <Button type="button" variant="ghost" size="sm" className="mt-0.5" onClick={() => remove(i)}>
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={fields.length >= carpoolPeople - 1}
              onClick={() => append({ name: '', employeeEmail: '' })}
            >
              Add member
            </Button>
          </fieldset>

          <Button type="submit" loading={createBookings.isPending} disabled={submitBlocked} className="w-full">
            {/* Covers "nothing selected", "nothing in the window is open at all", and a stale selection. */}
            {submitBlocked
              ? 'Pick an available date'
              : bookingDates.length === 1
                ? 'Submit request'
                : `Submit ${bookingDates.length} requests`}
          </Button>
        </form>
      </Card>
    </div>
  );
}

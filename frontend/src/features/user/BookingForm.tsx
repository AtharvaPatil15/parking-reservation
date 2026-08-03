import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useFieldArray, useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Card,
  Input,
  LoadingState,
  ErrorState,
  SuccessState,
  SlotGrid,
  SlotGridLegend,
} from '../../components';
import { useAvailability, useCreateBooking, useMe } from '../../api/hooks';
import { ApiError, apiErrorText } from '../../api/http';
import { useCountdown } from '../../lib/useCountdown';
import { cn } from '../../lib/cn';
import { BackLink } from '../shared/BackLink';
import { bookingSchema, type BookingFormValues } from './bookingSchema';
import { formatCountdown } from '../../lib/dates';
import type { components } from '../../api/types';

type DayAvailability = components['schemas']['DayAvailability'];

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
 * Book a slot (Phase 7). The user picks a date inside the rolling window, sees that date's slot grid
 * before committing, and cannot submit once the grid is full — the server enforces the same rule, so
 * demand never exceeds supply and nobody is rejected after the fact.
 */
export function BookingForm() {
  const me = useMe();
  const availability = useAvailability();
  const createBooking = useCreateBooking();

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    setError,
    formState: { errors },
  } = useForm<BookingFormValues>({
    resolver: zodResolver(bookingSchema),
    defaultValues: { bookingDate: '', carpoolPeople: 1, carpoolMembers: [] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'carpoolMembers' });
  const carpoolPeople = Number(watch('carpoolPeople')) || 1;
  const bookingDate = watch('bookingDate');

  const window_ = availability.data?.window;
  // Weekends are in the payload for completeness but are never bookable (D7) — leave them out.
  const days: DayAvailability[] = (availability.data?.days ?? []).filter((d) => d.reason !== 'NOT_WEEKDAY');
  const selected = days.find((d) => d.date === bookingDate);

  // Land on the first date the user can actually book rather than an arbitrary "tomorrow".
  const firstOpen = days.find((d) => d.requestable)?.date;
  useEffect(() => {
    if (!bookingDate && firstOpen) setValue('bookingDate', firstOpen, { shouldValidate: false });
  }, [bookingDate, firstOpen, setValue]);

  const secondsLeft = useCountdown(window_?.nextRunCountdownSeconds);
  const runUrgent = secondsLeft != null && secondsLeft > 0 && secondsLeft <= FINAL_WINDOW_SECONDS;

  if (me.isLoading || availability.isLoading) return <LoadingState label="Loading booking form…" />;
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

  if (createBooking.isSuccess) {
    return (
      <SuccessState
        title="Request submitted"
        description={
          window_
            ? `Your slot for ${dayLabel(createBooking.data.bookingDate)} is held. Results are published ${runLabel(window_.nextRunAt)}.`
            : `Booking ${createBooking.data.id} is ${createBooking.data.status.toLowerCase()}.`
        }
        action={
          <Link to={`/booking/${createBooking.data.id}`} className="text-primary hover:underline">
            View status
          </Link>
        }
      />
    );
  }

  // A 400 with field `details` (e.g. an unknown carpool-member email) is shown inline on
  // the offending field, so suppress the generic banner for it.
  const err = createBooking.error;
  const isFieldError = err instanceof ApiError && err.status === 400 && Boolean(err.details?.length);
  const errorMsg =
    createBooking.isError && !isFieldError
      ? err instanceof ApiError
        ? err.code === 'CAPACITY_FULL'
          ? `${err.message} The grid below has been refreshed.`
          : err.code === 'WINDOW_CLOSED'
            // Keep the server's wording: it names the earliest date the user *can* pick.
            ? err.message
            : err.status === 409
              ? 'You already have a request for this date.'
              : (apiErrorText(err) ?? err.message)
        : 'Something went wrong. Please try again.'
      : null;

  const submitBlocked = !selected || !selected.requestable;

  const onSubmit = handleSubmit((values) => {
    createBooking.mutate(
      {
        bookingDate: values.bookingDate,
        // Demo simplification: the UI only offers car bookings. The API/enum still accepts BIKE/EV_CAR,
        // so this is a client-side narrowing, not a contract change — the picker can be restored later.
        vehicleType: 'CAR',
        vehicleNumber: values.vehicleNumber || undefined,
        carpoolPeople: Number(values.carpoolPeople),
        specialRequirement: values.specialRequirement || undefined,
        // Email is required by the schema, so pass it through unchanged (no `|| undefined`).
        carpoolMembers: values.carpoolMembers?.map((m) => ({ name: m.name, employeeEmail: m.employeeEmail })),
      },
      {
        onError: (e) => {
          // Map server-side member validation (unknown emails) back onto each field.
          if (e instanceof ApiError && e.status === 400 && e.details?.length) {
            for (const d of e.details) setError(d.field as FieldPath<BookingFormValues>, { message: d.message });
          }
          // Losing a race for the last slot means the grid on screen is stale — pull the truth back.
          if (e instanceof ApiError && e.code === 'CAPACITY_FULL') availability.refetch();
        },
      },
    );
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3">
        <BackLink />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Book a parking slot</h1>
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

      {/* Window overview — pick a date by its remaining capacity, at a glance. */}
      <Card>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-text">Choose a date</h2>
            <SlotGridLegend />
          </div>
          {days.length === 0 ? (
            <p className="text-sm text-text-muted">No dates are open for booking right now.</p>
          ) : (
            <ul className="divide-y divide-border">
              {days.map((day) => {
                const isSelected = day.date === bookingDate;
                return (
                  <li key={day.date}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      disabled={!day.requestable}
                      onClick={() => setValue('bookingDate', day.date, { shouldValidate: true })}
                      className={cn(
                        'flex w-full flex-wrap items-center justify-between gap-3 rounded-control px-2 py-2.5 text-left transition-colors',
                        day.requestable ? 'hover:bg-surface-2' : 'cursor-not-allowed opacity-60',
                        isSelected && 'bg-primary-subtle',
                      )}
                    >
                      <span className="flex min-w-[9rem] flex-col">
                        <span className="text-sm font-medium text-text">{dayLabel(day.date)}</span>
                        <span className="text-xs text-text-muted">
                          {day.requestable
                            ? `${day.available} of ${day.quota} free`
                            : (day.message ?? 'Not available')}
                        </span>
                      </span>
                      <SlotGrid boxes={day.boxes} size="sm" />
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

          {selected && (
            <div className="space-y-2 rounded-control border border-border bg-surface-2/50 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-text">{dayLabel(selected.date)}</p>
                <p className="text-sm text-text-muted">
                  {selected.available} of {selected.quota} slots free
                  {selected.blocked > 0 && ` · ${selected.blocked} blocked`}
                </p>
              </div>
              <SlotGrid boxes={selected.boxes} />
              {!selected.requestable && selected.message && (
                <p role="status" className="text-sm text-warning">
                  {selected.message}
                </p>
              )}
            </div>
          )}
          {errors.bookingDate?.message && <p className="text-sm text-danger">{errors.bookingDate.message}</p>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Car number" {...register('vehicleNumber')} error={errors.vehicleNumber?.message} hint="Optional — helps security match you at the gate." />
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

          <Button type="submit" loading={createBooking.isPending} disabled={submitBlocked} className="w-full">
            {/* Covers both "the chosen date is full" and "nothing in the window is open at all". */}
            {submitBlocked ? 'Pick an available date' : 'Submit request'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

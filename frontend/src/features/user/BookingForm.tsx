import { Link } from 'react-router-dom';
import { useFieldArray, useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Card, Input, LoadingState, SuccessState } from '../../components';
import { useCreateBooking, useMe, useUserDashboard } from '../../api/hooks';
import { ApiError, apiErrorText } from '../../api/http';
import { useCountdown } from '../../lib/useCountdown';
import { cn } from '../../lib/cn';
import { BackLink } from '../shared/BackLink';
import { bookingSchema, type BookingFormValues } from './bookingSchema';
import { formatCountdown, nextBookableWeekday } from '../../lib/dates';

// Escalate the cutoff timer to a warning tone inside the final 30 minutes.
const FINAL_WINDOW_SECONDS = 30 * 60;

export function BookingForm() {
  const me = useMe();
  const dashboard = useUserDashboard();
  const createBooking = useCreateBooking();

  const {
    register,
    handleSubmit,
    control,
    watch,
    setError,
    formState: { errors },
  } = useForm<BookingFormValues>({
    resolver: zodResolver(bookingSchema),
    defaultValues: { bookingDate: nextBookableWeekday(), carpoolPeople: 1, carpoolMembers: [] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'carpoolMembers' });
  const carpoolPeople = Number(watch('carpoolPeople')) || 1;

  const secondsLeft = useCountdown(dashboard.data?.cutoffCountdownSeconds);
  const windowClosed = secondsLeft != null && secondsLeft <= 0;
  const cutoffUrgent = secondsLeft != null && secondsLeft > 0 && secondsLeft <= FINAL_WINDOW_SECONDS;

  if (me.isLoading || dashboard.isLoading) return <LoadingState label="Loading booking form…" />;

  if (createBooking.isSuccess) {
    return (
      <SuccessState
        title="Request submitted"
        description={`Booking ${createBooking.data.id} is ${createBooking.data.status.toLowerCase()}.`}
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
        ? err.status === 409
          ? 'You already have a request for this date.'
          : err.code === 'WINDOW_CLOSED'
            ? 'The booking window is closed for this date.'
            : apiErrorText(err) ?? err.message
        : 'Something went wrong. Please try again.'
      : null;

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
        },
      },
    );
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-3">
        <BackLink />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Book a parking slot</h1>
            <p className="text-text-muted">
              Home → office: {me.data?.distanceKm != null ? `${me.data.distanceKm} km` : 'not set'} · used in scoring.
            </p>
          </div>
          {secondsLeft != null && (
            <span
              {...(windowClosed || cutoffUrgent ? { role: 'status' } : {})}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-control border px-3 py-1.5 text-sm',
                windowClosed
                  ? 'border-danger/30 bg-danger-subtle text-danger'
                  : cutoffUrgent
                    ? 'border-warning/30 bg-warning-subtle text-warning'
                    : 'border-border bg-surface text-text-muted',
              )}
            >
              {windowClosed ? (
                'Booking window closed'
              ) : (
                <>Cutoff in <span className="font-medium tabular-nums">{formatCountdown(secondsLeft)}</span></>
              )}
            </span>
          )}
        </div>
      </div>

      <Card>
        <form className="space-y-5" onSubmit={onSubmit} noValidate>
          {errorMsg && (
            <p role="alert" className="rounded-control border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">
              {errorMsg}
            </p>
          )}

          {/* Short fields paired into a 2-col grid so the form reads compactly.
              Demo is car-only, so there's no vehicle-type picker (see mutate body). */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Date" type="date" {...register('bookingDate')} error={errors.bookingDate?.message} />
            <Input label="Car number" {...register('vehicleNumber')} error={errors.vehicleNumber?.message} hint="Optional" />
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

          <div className="border-t border-border pt-5">
            <Input label="Special requirement" {...register('specialRequirement')} error={errors.specialRequirement?.message} />
          </div>

          <Button type="submit" loading={createBooking.isPending} disabled={windowClosed} className="w-full">
            Submit request
          </Button>
        </form>
      </Card>
    </div>
  );
}

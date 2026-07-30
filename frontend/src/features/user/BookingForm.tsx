import { Link } from 'react-router-dom';
import { useFieldArray, useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Card, Input, LoadingState, Select, SuccessState } from '../../components';
import { useCreateBooking, useMe, useUserDashboard } from '../../api/hooks';
import { ApiError } from '../../api/http';
import { useCountdown } from '../../lib/useCountdown';
import { VEHICLE_OPTIONS, bookingSchema, type BookingFormValues } from './bookingSchema';
import { formatCountdown, nextBookableWeekday } from '../../lib/dates';

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
            : err.message
        : 'Something went wrong. Please try again.'
      : null;

  const onSubmit = handleSubmit((values) => {
    createBooking.mutate(
      {
        bookingDate: values.bookingDate,
        vehicleType: values.vehicleType ? values.vehicleType : undefined,
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
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Book a parking slot</h1>
        <p className="text-text-muted">
          Home → office: {me.data?.distanceKm != null ? `${me.data.distanceKm} km` : 'not set'} · used in scoring.
        </p>
      </div>

      {secondsLeft != null && !windowClosed && (
        <p className="text-sm text-text-muted">Cutoff in {formatCountdown(secondsLeft)}</p>
      )}
      {windowClosed && (
        <p role="alert" className="text-sm text-danger">
          Booking window closed for this date.
        </p>
      )}

      <Card>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          {errorMsg && (
            <p role="alert" className="rounded-control border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">
              {errorMsg}
            </p>
          )}

          <Input label="Date" type="date" {...register('bookingDate')} error={errors.bookingDate?.message} />
          <Select
            label="Vehicle"
            placeholder="Select a vehicle"
            options={VEHICLE_OPTIONS}
            {...register('vehicleType')}
            error={errors.vehicleType?.message}
          />
          <Input label="Vehicle number" {...register('vehicleNumber')} error={errors.vehicleNumber?.message} />
          <Input
            label="Carpool people"
            type="number"
            min={1}
            max={4}
            hint="Including you (1–4)."
            {...register('carpoolPeople')}
            error={errors.carpoolPeople?.message}
          />

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium text-text">Carpool members (optional)</legend>
            <p className="-mt-1 text-xs text-text-muted">
              Each member must be a registered user (any company). Enter their work email.
            </p>
            {fields.map((f, i) => (
              <div key={f.id} className="flex items-start gap-2">
                <Input
                  aria-label={`Member ${i + 1} name`}
                  placeholder="Name"
                  {...register(`carpoolMembers.${i}.name`)}
                  error={errors.carpoolMembers?.[i]?.name?.message}
                />
                <Input
                  aria-label={`Member ${i + 1} email`}
                  placeholder="Employee email"
                  {...register(`carpoolMembers.${i}.employeeEmail`)}
                  error={errors.carpoolMembers?.[i]?.employeeEmail?.message}
                />
                <Button type="button" variant="ghost" onClick={() => remove(i)}>
                  Remove
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="secondary"
                disabled={fields.length >= carpoolPeople - 1}
                onClick={() => append({ name: '', employeeEmail: '' })}
              >
                Add member
              </Button>
            </div>
          </fieldset>

          <Input label="Special requirement" {...register('specialRequirement')} error={errors.specialRequirement?.message} />

          <Button type="submit" loading={createBooking.isPending} disabled={windowClosed}>
            Submit request
          </Button>
        </form>
      </Card>
    </div>
  );
}

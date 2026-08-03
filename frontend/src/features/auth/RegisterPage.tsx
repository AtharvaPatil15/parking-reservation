import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Card, Input, Select, SuccessState, type SelectOption } from '../../components';
import { PublicHeader } from '../../app/chrome';
import { useActiveCompanies, useRegister } from '../../api/hooks';
import { ApiError } from '../../api/http';
import { registerSchema, type RegisterFormValues } from './registerSchema';
import type { components } from '../../api/types';

type RegisterRequest = components['schemas']['RegisterRequest'];
type RegistrationType = NonNullable<RegisterRequest['registrationType']>;

const REGISTRATION_TYPE_OPTIONS: SelectOption[] = [
  { value: 'EMPLOYEE', label: 'Employee — book parking' },
  { value: 'COMPANY_ADMIN', label: 'Company admin — manage my company' },
  // Phase 7 (D15): a building gate operator. Approved by the super admin, never a company admin.
  { value: 'SECURITY', label: 'Security — operate the gate' },
];

export function RegisterPage() {
  const companies = useActiveCompanies();
  const registerUser = useRegister();
  const [submittedAs, setSubmittedAs] = useState<RegistrationType | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: '', registrationType: 'EMPLOYEE', companyId: '', email: '', contactNumber: '',
      address: '', pinCode: '', distanceKm: '', password: '', confirmPassword: '',
    },
  });

  // A gate operator has no tenant to pick and no commute to record (D15), so those fields are hidden
  // rather than disabled — an irrelevant field is noise, and the guard's whole job is two buttons.
  const isSecurity = watch('registrationType') === 'SECURITY';

  const companyOptions: SelectOption[] = (companies.data ?? []).map((c) => ({ value: c.id, label: c.name }));

  const onSubmit: SubmitHandler<RegisterFormValues> = (values) => {
    const body: RegisterRequest = {
      fullName: values.fullName,
      registrationType: values.registrationType,
      email: values.email,
      contactNumber: values.contactNumber,
      password: values.password,
      confirmPassword: values.confirmPassword,
      // Omitted entirely for SECURITY: the server assigns the building company and stores no home
      // address. Sending stale values from a switched-away-from selection would be misleading.
      ...(isSecurity
        ? {}
        : {
            companyId: values.companyId,
            address: values.address,
            pinCode: values.pinCode,
            distanceKm: values.distanceKm ? Number(values.distanceKm) : null,
          }),
    };
    registerUser.mutate(body, {
      onSuccess: () => setSubmittedAs(values.registrationType),
      onError: (err) => {
        if (err instanceof ApiError && err.status === 409) {
          setError('email', { message: 'An account with this email already exists.' });
        } else if (err instanceof ApiError && err.details?.length) {
          for (const d of err.details) {
            setError(d.field as keyof RegisterFormValues, { message: d.message });
          }
        }
      },
    });
  };

  // Field-level errors (409/validation details) are shown inline; only surface a
  // banner for unexpected failures.
  const isFieldError =
    registerUser.error instanceof ApiError &&
    (registerUser.error.status === 409 || Boolean(registerUser.error.details?.length));
  const formError =
    registerUser.isError && !isFieldError
      ? registerUser.error instanceof ApiError
        ? registerUser.error.message
        : 'Something went wrong. Please try again.'
      : null;

  return (
    <div className="min-h-screen bg-canvas text-text">
      <PublicHeader />
      <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
        {submittedAs ? (
          <Card>
            <SuccessState
              title="Registration submitted"
              description={
                submittedAs === 'EMPLOYEE'
                  ? "Your account is pending approval by your company admin. You'll be able to sign in once it's approved."
                  : `Your ${submittedAs === 'SECURITY' ? 'security' : 'company-admin'} request is pending approval by the super admin. You'll be able to sign in once it's approved.`
              }
              action={
                <Link to="/login" className="text-primary hover:underline">
                  Back to sign in
                </Link>
              }
            />
          </Card>
        ) : (
          <>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
              <p className="text-text-muted">Register to request parking. An admin approves new accounts.</p>
            </div>

            <Card>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
                <Input label="Full name" error={errors.fullName?.message} {...register('fullName')} />
                <Select
                  label="Registering as"
                  options={REGISTRATION_TYPE_OPTIONS}
                  hint={
                    isSecurity
                      ? 'Security accounts are approved by the super admin and cover the whole building.'
                      : 'Company-admin requests are approved by the super admin.'
                  }
                  error={errors.registrationType?.message}
                  {...register('registrationType')}
                />
                {!isSecurity && (
                  <Select
                    label="Company"
                    placeholder={companies.isLoading ? 'Loading companies…' : 'Select your company'}
                    options={companyOptions}
                    error={errors.companyId?.message}
                    {...register('companyId')}
                  />
                )}
                <Input label="Email" type="email" error={errors.email?.message} {...register('email')} />
                <Input label="Contact number" type="tel" inputMode="numeric" placeholder="10-digit mobile" error={errors.contactNumber?.message} {...register('contactNumber')} />
                {!isSecurity && (
                  <>
                    <Input label="Address" error={errors.address?.message} {...register('address')} />
                    <Input label="PIN code" inputMode="numeric" placeholder="6-digit PIN" error={errors.pinCode?.message} {...register('pinCode')} />
                    <Input
                      label="Home → office distance (km)"
                      type="number"
                      step="any"
                      hint="Optional — used for allocation scoring."
                      error={errors.distanceKm?.message}
                      {...register('distanceKm')}
                    />
                  </>
                )}
                <Input label="Password" type="password" error={errors.password?.message} {...register('password')} />
                <Input label="Confirm password" type="password" error={errors.confirmPassword?.message} {...register('confirmPassword')} />

                {formError && (
                  <p role="alert" className="rounded-control border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">
                    {formError}
                  </p>
                )}

                <Button type="submit" loading={registerUser.isPending} className="w-full">
                  Create account
                </Button>
              </form>
            </Card>

            <p className="text-center text-sm text-text-muted">
              Already have an account?{' '}
              <Link to="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}

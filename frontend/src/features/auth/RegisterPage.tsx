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

export function RegisterPage() {
  const companies = useActiveCompanies();
  const registerUser = useRegister();
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: '', companyId: '', email: '', contactNumber: '',
      address: '', pinCode: '', distanceKm: '', password: '', confirmPassword: '',
    },
  });

  const companyOptions: SelectOption[] = (companies.data ?? []).map((c) => ({ value: c.id, label: c.name }));

  const onSubmit: SubmitHandler<RegisterFormValues> = (values) => {
    const body: RegisterRequest = {
      fullName: values.fullName,
      companyId: values.companyId,
      email: values.email,
      contactNumber: values.contactNumber,
      address: values.address,
      pinCode: values.pinCode,
      distanceKm: values.distanceKm ? Number(values.distanceKm) : null,
      password: values.password,
      confirmPassword: values.confirmPassword,
    };
    registerUser.mutate(body, {
      onSuccess: () => setSubmitted(true),
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
        {submitted ? (
          <Card>
            <SuccessState
              title="Registration submitted"
              description="Your account is pending approval by your company admin. You'll be able to sign in once it's approved."
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
                  label="Company"
                  placeholder={companies.isLoading ? 'Loading companies…' : 'Select your company'}
                  options={companyOptions}
                  error={errors.companyId?.message}
                  {...register('companyId')}
                />
                <Input label="Email" type="email" error={errors.email?.message} {...register('email')} />
                <Input label="Contact number" error={errors.contactNumber?.message} {...register('contactNumber')} />
                <Input label="Address" error={errors.address?.message} {...register('address')} />
                <Input label="PIN code" error={errors.pinCode?.message} {...register('pinCode')} />
                <Input
                  label="Home → office distance (km)"
                  type="number"
                  step="any"
                  hint="Optional — used for allocation scoring."
                  error={errors.distanceKm?.message}
                  {...register('distanceKm')}
                />
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

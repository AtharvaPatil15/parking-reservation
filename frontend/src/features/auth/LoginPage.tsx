import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Input } from '../../components';
import { PublicHeader } from '../../app/chrome';
import { useAuth } from '../../lib/auth';
import { roleHome } from '../../lib/roles';
import { useLogin } from '../../api/hooks';
import { ApiError } from '../../api/http';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPage() {
  const { isAuthenticated, login, user } = useAuth();
  const navigate = useNavigate();
  const loginMutation = useLogin();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  useEffect(() => {
    if (isAuthenticated && user) navigate(roleHome(user.role), { replace: true });
  }, [isAuthenticated, navigate, user]);

  function validate(): boolean {
    const next: { email?: string; password?: string } = {};
    if (!email.trim()) next.email = 'Email is required.';
    else if (!EMAIL_RE.test(email)) next.email = 'Enter a valid email.';
    if (!password) next.password = 'Password is required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    loginMutation.mutate(
      { email, password },
      {
        onSuccess: (data) => {
          login({ accessToken: data.accessToken, user: data.user });
          navigate(roleHome(data.user.role), { replace: true });
        },
      },
    );
  }

  const formError = loginMutation.isError
    ? loginMutation.error instanceof ApiError && loginMutation.error.status === 401
      ? 'Invalid email or password.'
      : loginMutation.error instanceof ApiError
        ? loginMutation.error.message
        : 'Something went wrong. Please try again.'
    : null;

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-text lg:flex-row">
      {/* The dark plane: what the system does, stated once. Static copy — this is
          the public page, so there is no session to read live figures from. */}
      <aside className="flex shrink-0 flex-col justify-between gap-8 bg-field px-8 py-8 text-field-ink lg:w-[380px] lg:px-11 lg:py-11">
        <div className="flex items-center gap-2.5">
          <span className="grid h-[30px] w-[30px] shrink-0 place-items-center border border-field-ln2 font-heading text-lg leading-none text-field-accent">
            P
          </span>
          <span className="flex flex-col leading-[1.05]">
            <span className="font-heading text-lg uppercase tracking-[0.06em]">Parking</span>
            <span className="text-[10px] uppercase tracking-[0.22em] text-field-ink-3">Reservation</span>
          </span>
        </div>
        <div className="space-y-3">
          <p className="font-heading text-3xl leading-[1.04]">
            Book a bay
            <br />
            for the week ahead
          </p>
          <p className="max-w-[34ch] text-sm text-field-ink-2">
            Requests are scored on distance and carpool size, then allocated after the cutoff.
          </p>
        </div>
        <span className="font-mono text-2xs uppercase tracking-[0.16em] text-field-ink-3">
          Work email · admin approval
        </span>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <PublicHeader />
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-12">
          <div className="space-y-1">
            <h1 className="text-2xl">Sign in</h1>
            <p className="text-text-muted">Use your work email to access parking reservations.</p>
          </div>
          <Card>
            <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
              {formError && (
                <p
                  role="alert"
                  className="rounded-control border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger"
                >
                  {formError}
                </p>
              )}
              <Input
                label="Email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={errors.email}
              />
              <Input
                label="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={errors.password}
              />
              <Button type="submit" loading={loginMutation.isPending}>
                Sign in
              </Button>
            </form>
          </Card>
          <p className="text-sm text-text-muted">
            New here?{' '}
            <Link to="/register" className="text-primary hover:underline">
              Create an account
            </Link>
          </p>
        </main>
      </div>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Input } from '../../components';
import { PublicHeader } from '../../app/chrome';
import { useAuth } from '../../lib/auth';
import { roleHome } from '../../lib/roles';
import { useLogin } from '../../api/hooks';
import { ApiError } from '../../api/http';

const USERNAME_RE = /^[a-zA-Z0-9._-]+$/;

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
    if (!email.trim()) next.email = 'Username is required.';
    else if (!USERNAME_RE.test(email)) next.email = 'Enter a valid username.';
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
      ? 'Invalid username or password.'
      : loginMutation.error instanceof ApiError
        ? loginMutation.error.message
        : 'Something went wrong. Please try again.'
    : null;

  return (
    <div className="min-h-screen bg-canvas text-text">
      <PublicHeader />
      <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-text-muted">Use your username to access parking reservations.</p>
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
              label="Username"
              type="text"
              autoComplete="username"
              hint="Not your email — the username you registered with."
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
  );
}

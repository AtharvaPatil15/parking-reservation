import { useNavigate } from 'react-router-dom';
import { Button, Card } from '../../components';
import { PublicHeader } from '../../app/chrome';
import { useAuth, type AuthUser } from '../../lib/auth';
import { roleHome, type Role } from '../../lib/roles';

// TEMPORARY dev identities so guards/routing are clickable before the real login
// form + useLogin arrive in P5-05. Delete this block and the "Developer sign-in"
// card when P5-05 lands.
const DEV_USERS: Record<Role, AuthUser> = {
  SUPER_ADMIN: { id: 'dev-super', fullName: 'Dev Super Admin', role: 'SUPER_ADMIN', companyId: null, companyName: 'Platform' },
  COMPANY_ADMIN: { id: 'dev-company', fullName: 'Dev Company Admin', role: 'COMPANY_ADMIN', companyId: 'dev-co', companyName: 'Acme Co' },
  USER: { id: 'dev-user', fullName: 'Dev User', role: 'USER', companyId: 'dev-co', companyName: 'Acme Co' },
};

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  function devSignIn(role: Role) {
    login({ accessToken: 'dev-token', user: DEV_USERS[role] });
    navigate(roleHome(role), { replace: true });
  }

  return (
    <div className="min-h-screen bg-canvas text-text">
      <PublicHeader />
      <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-text-muted">The real login form arrives in P5-05.</p>
        </div>
        <Card title="Developer sign-in" description="Temporary — pick a role to exercise the routing and guards.">
          <div className="flex flex-col gap-3">
            <Button onClick={() => devSignIn('SUPER_ADMIN')}>Sign in as Super Admin</Button>
            <Button variant="secondary" onClick={() => devSignIn('COMPANY_ADMIN')}>
              Sign in as Company Admin
            </Button>
            <Button variant="secondary" onClick={() => devSignIn('USER')}>
              Sign in as User
            </Button>
          </div>
        </Card>
      </main>
    </div>
  );
}

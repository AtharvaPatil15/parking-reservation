import { Card } from '../../components';
import { useAuth } from '../../lib/auth';

export function AdminShell() {
  const { user } = useAuth();
  return (
    <Card title="Super Admin">
      <p className="text-text-muted">
        Signed in as {user?.fullName}. Allocation run, config timings, and management screens land in
        P5-09–P5-11.
      </p>
    </Card>
  );
}

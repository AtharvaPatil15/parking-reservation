import { Card } from '../../components';
import { useAuth } from '../../lib/auth';

export function CompanyShell() {
  const { user } = useAuth();
  return (
    <Card title="Company Admin">
      <p className="text-text-muted">
        Signed in as {user?.fullName} ({user?.companyName}). Approvals, blocks, and the company
        dashboard land in P5-12.
      </p>
    </Card>
  );
}

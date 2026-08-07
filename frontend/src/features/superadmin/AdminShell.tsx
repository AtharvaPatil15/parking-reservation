import { Outlet } from 'react-router-dom';
import { useRegisterNavDrawerItems } from '../../app/navDrawer';
import { ROLE_NAV } from '../../app/roleNav';

/**
 * Super-admin area layout; content routes through the Outlet. The area heading
 * lives in the rail and crumb strip now, so the shell adds no heading of its own.
 */
export function AdminShell() {
  useRegisterNavDrawerItems(ROLE_NAV.SUPER_ADMIN);
  return (
    <div className="space-y-6">
      <Outlet />
    </div>
  );
}

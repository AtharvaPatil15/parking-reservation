import { Outlet } from 'react-router-dom';
import { useRegisterNavDrawerItems } from '../../app/navDrawer';
import { ROLE_NAV } from '../../app/roleNav';

/** User-area layout: nav drawer (top bar hamburger) + routed content. */
export function UserShell() {
  useRegisterNavDrawerItems(ROLE_NAV.USER);
  return (
    <div className="space-y-6">
      <Outlet />
    </div>
  );
}

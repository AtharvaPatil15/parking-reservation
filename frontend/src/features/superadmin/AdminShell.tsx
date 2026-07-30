import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '../../lib/cn';

const NAV = [
  { to: '/admin', label: 'Allocation', end: true },
  { to: '/admin/dashboard', label: 'Dashboard' },
  { to: '/admin/config', label: 'Config' },
  { to: '/admin/companies', label: 'Companies' },
  { to: '/admin/admin-requests', label: 'Admin requests' },
  { to: '/admin/slots', label: 'Slots' },
];

/** Super-admin area layout: heading + section nav; content routes through the Outlet. */
export function AdminShell() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Super Admin</h1>
      <nav className="flex flex-wrap gap-1 border-b border-border">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary text-text'
                  : 'border-transparent text-text-muted hover:text-text',
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

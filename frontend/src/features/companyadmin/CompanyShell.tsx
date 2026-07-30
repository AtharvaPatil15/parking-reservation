import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '../../lib/cn';

const NAV = [
  { to: '/company', label: 'Dashboard', end: true },
  { to: '/company/allocations', label: 'Allocations' },
  { to: '/company/approvals', label: 'Approvals' },
  { to: '/company/blocks', label: 'Blocks' },
  { to: '/book', label: 'Book' },
  { to: '/my-bookings', label: 'My bookings' },
];

/** Company-admin area layout: heading + section nav; content routes through the Outlet. */
export function CompanyShell() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Company Admin</h1>
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

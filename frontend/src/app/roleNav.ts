import type { Role } from '../lib/roles';
import type { NavDrawerItem } from './navDrawer';

/**
 * The navigation menu for each role.
 *
 * Lives here rather than inside each role shell so the top bar can fall back to the signed-in
 * role's menu on pages that sit outside a shell — /profile and the security console register no
 * items of their own, and the hamburger must still lead somewhere from there.
 */
export const ROLE_NAV: Record<Role, NavDrawerItem[]> = {
  SUPER_ADMIN: [
    { to: '/admin', label: 'Dashboard', end: true },
    // The weekly batch is the normal run path; the per-date run stays for ad-hoc use.
    { to: '/admin/weekly-run', label: 'Weekly run' },
    { to: '/admin/allocation', label: 'Run by date' },
    { to: '/admin/config', label: 'Config' },
    { to: '/admin/companies', label: 'Companies' },
    { to: '/admin/admin-requests', label: 'Admin requests' },
    { to: '/admin/slots', label: 'Slots' },
    { to: '/book', label: 'Book' },
    { to: '/my-bookings', label: 'My bookings' },
    { to: '/profile', label: 'Profile' },
  ],
  COMPANY_ADMIN: [
    { to: '/company', label: 'Dashboard', end: true },
    { to: '/company/allocations', label: 'Allocations' },
    { to: '/company/approvals', label: 'Approvals' },
    { to: '/company/blocks', label: 'Blocks' },
    { to: '/book', label: 'Book' },
    { to: '/my-bookings', label: 'My bookings' },
    { to: '/profile', label: 'Profile' },
  ],
  USER: [
    { to: '/app', label: 'Dashboard', end: true },
    { to: '/book', label: 'Book a slot' },
    { to: '/my-bookings', label: 'History' },
    { to: '/profile', label: 'Profile' },
  ],
  // A gate operator has one screen (D15), but still needs a way to reach their profile.
  SECURITY: [
    { to: '/security', label: 'Gate console', end: true },
    { to: '/profile', label: 'Profile' },
  ],
};

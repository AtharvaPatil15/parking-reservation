import type { Role } from '../lib/roles';
import type { NavDrawerItem } from './navDrawer';

/**
 * The navigation menu for each role.
 *
 * Lives here rather than inside each role shell so the nav rail can fall back to the signed-in
 * role's menu on pages that sit outside a shell — /profile and the security console register no
 * items of their own, and the rail must still lead somewhere from there.
 *
 * Routes and labels are upstream's, including the `/admin` → Dashboard and `/admin/weekly-run`
 * split; the `icon` / `dividerBefore` / `count` fields are the reskin's additions, which the rail
 * renders (see AppSidebar, navIcons, useNavCounts). `dividerBefore` marks where the role's own
 * section ends and the cross-role links that belong to the person begin.
 */
export const ROLE_NAV: Record<Role, NavDrawerItem[]> = {
  SUPER_ADMIN: [
    { to: '/admin', label: 'Dashboard', end: true, icon: 'dashboard' },
    // The weekly batch is the normal run path; the per-date run stays for ad-hoc use.
    { to: '/admin/weekly-run', label: 'Weekly run', icon: 'play' },
    { to: '/admin/allocation', label: 'Run by date', icon: 'calendar' },
    { to: '/admin/config', label: 'Config', icon: 'sliders' },
    { to: '/admin/companies', label: 'Companies', icon: 'building' },
    { to: '/admin/admin-requests', label: 'Admin requests', icon: 'shield' },
    { to: '/admin/slots', label: 'Slots', icon: 'grid' },
    { to: '/book', label: 'Book', icon: 'park', dividerBefore: true },
    { to: '/my-bookings', label: 'My bookings', icon: 'history' },
    { to: '/profile', label: 'Profile', icon: 'user' },
  ],
  COMPANY_ADMIN: [
    { to: '/company', label: 'Dashboard', end: true, icon: 'dashboard' },
    { to: '/company/allocations', label: 'Allocations', icon: 'grid' },
    { to: '/company/approvals', label: 'Approvals', icon: 'users' },
    { to: '/company/blocks', label: 'Blocks', icon: 'ban' },
    { to: '/book', label: 'Book', icon: 'park', dividerBefore: true },
    { to: '/my-bookings', label: 'My bookings', icon: 'history' },
    { to: '/profile', label: 'Profile', icon: 'user' },
  ],
  USER: [
    { to: '/app', label: 'Dashboard', end: true, icon: 'dashboard' },
    { to: '/book', label: 'Book a slot', icon: 'park' },
    { to: '/my-bookings', label: 'History', icon: 'history' },
    { to: '/profile', label: 'Profile', icon: 'user' },
  ],
  // A gate operator has one screen (D15), but still needs a way to reach their profile.
  SECURITY: [
    { to: '/security', label: 'Gate console', end: true, icon: 'shield' },
    { to: '/profile', label: 'Profile', icon: 'user' },
  ],
};

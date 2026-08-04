import type { NavDrawerItem } from './navDrawer';
import type { Role } from '../lib/roles';

/**
 * The nav rail's contents, keyed by role rather than by which role shell happens
 * to be mounted.
 *
 * This is why it lives here and not in the shells: five routes mount AppShell with
 * no role shell inside (/security, /book, /booking/:id, /my-bookings, /profile), so
 * shell-registered nav left the rail empty on exactly those screens — and entirely
 * empty for SECURITY, whose only route is /security. Deriving from the role means
 * every page of every persona gets the same populated rail.
 *
 * Structure follows the redesign's own NAV map (AppSidebarClassic): the role's own
 * section first, then a rule, then the cross-role booking links that belong to the
 * person rather than to the role. Labels are the app's existing terminology.
 */
export const ROLE_NAV: Record<Role, NavDrawerItem[]> = {
  USER: [
    { to: '/app', label: 'Dashboard', end: true, icon: 'dashboard' },
    { to: '/book', label: 'Book a slot', icon: 'park' },
    { to: '/my-bookings', label: 'History', icon: 'history' },
  ],
  COMPANY_ADMIN: [
    { to: '/company', label: 'Dashboard', end: true, icon: 'dashboard' },
    { to: '/company/allocations', label: 'Allocations', icon: 'grid' },
    { to: '/company/approvals', label: 'Approvals', icon: 'users' },
    { to: '/company/blocks', label: 'Blocks', icon: 'ban' },
    { to: '/book', label: 'Book', icon: 'park', dividerBefore: true },
    { to: '/my-bookings', label: 'My bookings', icon: 'history' },
  ],
  SUPER_ADMIN: [
    { to: '/admin', label: 'Weekly run', end: true, icon: 'play' },
    { to: '/admin/allocation', label: 'Run by date', icon: 'calendar' },
    { to: '/admin/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: '/admin/config', label: 'Config', icon: 'sliders' },
    { to: '/admin/companies', label: 'Companies', icon: 'building' },
    { to: '/admin/admin-requests', label: 'Admin requests', icon: 'shield' },
    { to: '/admin/slots', label: 'Slots', icon: 'grid' },
    { to: '/book', label: 'Book', icon: 'park', dividerBefore: true },
    { to: '/my-bookings', label: 'My bookings', icon: 'history' },
  ],
  /**
   * A gate operator has exactly one working screen (Phase 7 D15) and no parking of
   * their own to manage, so there are no booking links to divide off. The rail still
   * names the section so the plane is never a bare brand bar.
   */
  SECURITY: [{ to: '/security', label: 'Gate', end: true, icon: 'shield' }],
};

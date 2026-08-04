import { useCompanies, usePendingAdmins, useSlots } from '../api/hooks';
import type { NavDrawerItem } from './navDrawer';

/**
 * Live figures for the nav rail's right-hand column, as the redesign shows
 * ("Companies 6", "Slots 240", "Admin requests 1").
 *
 * Super-admin rows only: these are the rows the app can count cheaply, because the
 * screens they link to already run these same queries, so react-query serves them
 * from cache and the rail reads nothing but `meta.total`. Roles without a cheap
 * source get no counts rather than invented ones.
 *
 * Call this ONLY from a component that renders for SUPER_ADMIN — the hooks it wraps
 * take no `enabled` flag (they live in api/hooks, which this work treats as
 * off-limits), so gating has to happen at the call site. See AppSidebar.
 */
export function useSuperAdminNavCounts(items: NavDrawerItem[]): NavDrawerItem[] {
  const companies = useCompanies(1, 1);
  const slots = useSlots(1, 1);
  const pendingAdmins = usePendingAdmins(1, 1);

  const byPath: Record<string, number | undefined> = {
    '/admin/companies': companies.data?.meta.total,
    '/admin/slots': slots.data?.meta.total,
    '/admin/admin-requests': pendingAdmins.data?.meta.total,
  };

  return items.map((item) => {
    const count = byPath[item.to];
    return count == null ? item : { ...item, count };
  });
}

export type Role = 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'SECURITY' | 'USER';

/** Landing route for a role — used after login and when bouncing off a wrong-role page. */
export function roleHome(role: Role): string {
  switch (role) {
    case 'SUPER_ADMIN':
      return '/admin';
    case 'COMPANY_ADMIN':
      return '/company';
    // A gate operator has exactly one screen (Phase 7 D15) — check in / check out.
    case 'SECURITY':
      return '/security';
    case 'USER':
      return '/app';
    default:
      // A stale/casted/JSON-sourced value that isn't one of the known roles —
      // treat it as needing re-authentication rather than returning undefined.
      return '/login';
  }
}

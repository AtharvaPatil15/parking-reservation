export type Role = 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'SECURITY' | 'USER';

// SECURITY sits above USER: a gate operator's screens are their whole job, so if an account somehow
// carries both, the gate role wins. It stays below the admin roles, which are strictly broader.
const PRECEDENCE: Role[] = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'SECURITY', 'USER'];

/** Resolve a user's effective role from their assigned role names (highest precedence wins). */
export function pickPrimaryRole(roleNames: string[]): Role {
  for (const r of PRECEDENCE) if (roleNames.includes(r)) return r;
  return 'USER';
}

export type Role = 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'USER';

const PRECEDENCE: Role[] = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'USER'];

/** Resolve a user's effective role from their assigned role names (highest precedence wins). */
export function pickPrimaryRole(roleNames: string[]): Role {
  for (const r of PRECEDENCE) if (roleNames.includes(r)) return r;
  return 'USER';
}

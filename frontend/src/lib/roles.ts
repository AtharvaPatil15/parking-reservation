export type Role = 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'USER';

/** Landing route for a role — used after login and when bouncing off a wrong-role page. */
export function roleHome(role: Role): string {
  switch (role) {
    case 'SUPER_ADMIN':
      return '/admin';
    case 'COMPANY_ADMIN':
      return '/company';
    case 'USER':
      return '/app';
  }
}

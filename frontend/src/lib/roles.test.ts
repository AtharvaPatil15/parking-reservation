import { describe, expect, it } from 'vitest';
import { roleHome, type Role } from './roles';

describe('roleHome', () => {
  it('maps each role to its landing route', () => {
    expect(roleHome('SUPER_ADMIN')).toBe('/admin');
    expect(roleHome('COMPANY_ADMIN')).toBe('/company');
    expect(roleHome('USER')).toBe('/app');
  });

  it('falls back to /login for an unknown role value', () => {
    expect(roleHome('BOGUS' as unknown as Role)).toBe('/login');
  });
});

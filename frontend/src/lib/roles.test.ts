import { describe, expect, it } from 'vitest';
import { roleHome } from './roles';

describe('roleHome', () => {
  it('maps each role to its landing route', () => {
    expect(roleHome('SUPER_ADMIN')).toBe('/admin');
    expect(roleHome('COMPANY_ADMIN')).toBe('/company');
    expect(roleHome('USER')).toBe('/app');
  });
});

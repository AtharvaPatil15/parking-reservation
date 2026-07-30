import jwt from 'jsonwebtoken';
import { describe, it, expect } from 'vitest';
import { signAccessToken, verifyAccessToken } from '../src/lib/jwt';

/** JWT access-token hardening: HS256-pinned sign/verify, no forged or unsigned tokens accepted. */
describe('access token verification', () => {
  const payload = { sub: 'u1', role: 'USER' as const, companyId: 'c1' };

  it('signs and verifies a round-trip', () => {
    expect(verifyAccessToken(signAccessToken(payload))).toEqual(payload);
  });

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign(payload, 'not-the-real-secret', { algorithm: 'HS256', expiresIn: 900 });
    expect(() => verifyAccessToken(forged)).toThrow();
  });

  it('rejects an unsigned alg:none token (algorithm confusion)', () => {
    const unsigned = jwt.sign(payload, '', { algorithm: 'none' });
    expect(() => verifyAccessToken(unsigned)).toThrow();
  });
});

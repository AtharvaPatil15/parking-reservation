import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { Role } from './roles';

export interface AccessPayload {
  sub: string; // user id
  role: Role;
  companyId: string;
}

// Pin HS256 explicitly on both sign and verify so a token can't be smuggled in under a different
// algorithm (e.g. "alg":"none" or an RS/HS confusion) — the verifier only trusts HS256 signatures.
const ALGS: jwt.Algorithm[] = ['HS256'];

export function signAccessToken(payload: AccessPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { algorithm: 'HS256', expiresIn: env.ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): AccessPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ALGS }) as jwt.JwtPayload;
  return { sub: String(decoded.sub), role: decoded.role as Role, companyId: decoded.companyId as string };
}

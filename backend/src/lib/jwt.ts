import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { Role } from './roles';

export interface AccessPayload {
  sub: string; // user id
  role: Role;
  companyId: string;
}

export function signAccessToken(payload: AccessPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): AccessPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
  return { sub: String(decoded.sub), role: decoded.role as Role, companyId: decoded.companyId as string };
}

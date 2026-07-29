import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { signAccessToken } from '../../lib/jwt';
import { pickPrimaryRole, type Role } from '../../lib/roles';
import { env } from '../../config/env';
import { UnauthenticatedError, ForbiddenError, ValidationError, ConflictError } from '../../lib/errors';
import { isUniqueViolation } from '../../lib/prismaErrors';
import { getNumber } from '../../config/systemConfig';
import { recordAudit } from '../../lib/audit';
import type { RegisterInput } from './auth.schema';

const DEFAULT_MIN_PASSWORD_LENGTH = 8;

const hashToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');

export interface AuthUser {
  id: string;
  fullName: string;
  role: Role;
  companyId: string;
  companyName: string;
}
export interface Tokens {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshToken: string; // raw (goes into the cookie)
  refreshExpiresAt: Date;
}

async function issueRefreshToken(userId: string, ip?: string) {
  const raw = randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000);
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(raw), expiresAt, createdByIp: ip },
  });
  return { raw, expiresAt };
}

export async function login(
  email: string,
  password: string,
  ip?: string,
): Promise<Tokens & { user: AuthUser }> {
  const user = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    include: { roles: { include: { role: true } }, company: true },
  });
  // Generic message — don't reveal which of email/password was wrong.
  if (!user) throw new UnauthenticatedError('Invalid credentials');

  const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
  if (!ok) throw new UnauthenticatedError('Invalid credentials');
  if (user.status !== 'ACTIVE') throw new ForbiddenError('Account is not active');

  const role = pickPrimaryRole(user.roles.map((r) => r.role.name));
  const accessToken = signAccessToken({ sub: user.id, role, companyId: user.companyId });
  const { raw, expiresAt } = await issueRefreshToken(user.id, ip);

  return {
    accessToken,
    tokenType: 'Bearer',
    expiresIn: env.ACCESS_TOKEN_TTL,
    refreshToken: raw,
    refreshExpiresAt: expiresAt,
    user: {
      id: user.id,
      fullName: user.fullName,
      role,
      companyId: user.companyId,
      companyName: user.company.name,
    },
  };
}

/**
 * Register a new company user (P4-20). Creates a PENDING account under an ACTIVE company; the
 * Company Admin approves it later (P4-07). Returns the created user (with company + roles) — no
 * token, since a PENDING user cannot log in until approved. Contract documents 400/409 only, so
 * company problems surface as 400 (not 404).
 */
export async function register(input: RegisterInput) {
  // Company must exist and be ACTIVE.
  const company = await prisma.company.findFirst({ where: { id: input.companyId, deletedAt: null } });
  if (!company || company.status !== 'ACTIVE') {
    throw new ValidationError('Request validation failed', [
      { field: 'companyId', message: 'Company not found or not active' },
    ]);
  }

  // Password strength — config-driven (D8).
  const minLength = (await getNumber('password.minLength')) ?? DEFAULT_MIN_PASSWORD_LENGTH;
  if (input.password.length < minLength) {
    throw new ValidationError('Request validation failed', [
      { field: 'password', message: `Password must be at least ${minLength} characters` },
    ]);
  }

  // Reject a duplicate (active) email up front for a clean 409; the DB unique is the backstop.
  const existing = await prisma.user.findFirst({ where: { email: input.email, deletedAt: null } });
  if (existing) throw new ConflictError('An account with this email already exists');

  const passwordHash = await argon2.hash(input.password);
  try {
    const user = await prisma.user.create({
      data: {
        fullName: input.fullName,
        email: input.email,
        contactNumber: input.contactNumber,
        address: input.address,
        pinCode: input.pinCode,
        passwordHash,
        status: 'PENDING',
        emailVerified: false,
        distanceKm: input.distanceKm ?? null,
        companyId: company.id,
        roles: { create: { role: { connect: { name: 'USER' } } } },
      },
      include: { company: true, roles: { include: { role: true } } },
    });
    await recordAudit({
      actionType: 'USER_REGISTERED',
      entityType: 'User',
      entityId: user.id,
      newValue: { email: user.email, companyId: user.companyId, status: user.status },
    });
    return user;
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError('An account with this email already exists');
    throw err;
  }
}

/** Rotate the refresh token (revoke old, issue new) and mint a fresh access token. */
export async function refresh(rawToken: string | undefined, ip?: string): Promise<Tokens> {
  if (!rawToken) throw new UnauthenticatedError('No refresh token');
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!row || row.revokedAt || row.expiresAt < new Date()) {
    throw new UnauthenticatedError('Invalid refresh token');
  }
  const user = await prisma.user.findFirst({
    where: { id: row.userId, deletedAt: null },
    include: { roles: { include: { role: true } } },
  });
  if (!user || user.status !== 'ACTIVE') throw new UnauthenticatedError('Invalid refresh token');

  const { raw, expiresAt } = await issueRefreshToken(user.id, ip);
  await prisma.refreshToken.update({
    where: { id: row.id },
    data: { revokedAt: new Date(), replacedByTokenHash: hashToken(raw) },
  });

  const role = pickPrimaryRole(user.roles.map((r) => r.role.name));
  return {
    accessToken: signAccessToken({ sub: user.id, role, companyId: user.companyId }),
    tokenType: 'Bearer',
    expiresIn: env.ACCESS_TOKEN_TTL,
    refreshToken: raw,
    refreshExpiresAt: expiresAt,
  };
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

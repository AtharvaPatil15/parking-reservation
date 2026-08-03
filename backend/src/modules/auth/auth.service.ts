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

/**
 * The building operator's own company (seeded as "Redbricks (Building Administrator)") — the tenant a
 * SECURITY account is filed under, since the gate is building-wide and not tenant-scoped (D15).
 * Matched by `code` because that is the stable identity in the seed; ids are cuids and differ per DB.
 */
const BUILDING_COMPANY_CODE = 'REDBRICKS';

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
 * Register a new company user (P4-20). Creates a PENDING account under an ACTIVE company; no token
 * is returned since a PENDING user cannot log in until approved. Contract documents 400/409 only,
 * so company problems surface as 400 (not 404).
 *
 * `registrationType` (F11):
 *  - `EMPLOYEE`      → seeded with the `USER` role; the **Company Admin** approves it (P4-07).
 *  - `COMPANY_ADMIN` → requests admin of the (existing, ACTIVE) company; seeded with the
 *    `COMPANY_ADMIN` role but still PENDING. The **Super Admin** approves it, and that approval
 *    also creates the `CompanyAdmin` assignment (see users.service `setApproval`).
 *  - `SECURITY`      → a gate operator (Phase 7 D15). Seeded with the `SECURITY` role and approved by
 *    the **Super Admin** only; approval simply activates the account (no `CompanyAdmin` row). They
 *    register under the building company but their gate screens are not tenant-scoped.
 * In every case the role is assigned now but access is gated by `status = PENDING`.
 */
export async function register(input: RegisterInput) {
  // Company must exist and be ACTIVE. A SECURITY applicant does not choose one (D15): the gate serves
  // the whole building, so they are attached to the building company server-side. Resolving it here
  // rather than trusting a client-supplied id also stops a guard account being filed under a tenant.
  const company =
    input.registrationType === 'SECURITY'
      ? await prisma.company.findFirst({ where: { code: BUILDING_COMPANY_CODE, deletedAt: null } })
      : await prisma.company.findFirst({ where: { id: input.companyId, deletedAt: null } });
  if (!company || company.status !== 'ACTIVE') {
    throw new ValidationError('Request validation failed', [
      input.registrationType === 'SECURITY'
        ? {
            field: 'registrationType',
            message: `No active building company (code ${BUILDING_COMPANY_CODE}); ask the super admin to set one up`,
          }
        : { field: 'companyId', message: 'Company not found or not active' },
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

  const roleName =
    input.registrationType === 'COMPANY_ADMIN'
      ? 'COMPANY_ADMIN'
      : input.registrationType === 'SECURITY'
        ? 'SECURITY'
        : 'USER';
  const passwordHash = await argon2.hash(input.password);
  try {
    const user = await prisma.user.create({
      data: {
        fullName: input.fullName,
        email: input.email,
        contactNumber: input.contactNumber,
        // Blank for a guard: not collected (D15). Forced blank rather than defaulted, so a client that
        // sends these anyway cannot record a home address against a gate account. The columns are
        // non-null and widening them to nullable would ripple through every screen that renders a user,
        // so a guard simply carries no address rather than a fabricated one.
        address: input.registrationType === 'SECURITY' ? '' : (input.address ?? ''),
        pinCode: input.registrationType === 'SECURITY' ? '' : (input.pinCode ?? ''),
        passwordHash,
        status: 'PENDING',
        emailVerified: false,
        // Scoring is an employee concern; a guard is never allocated a slot, so never carries a distance.
        distanceKm: input.registrationType === 'SECURITY' ? null : (input.distanceKm ?? null),
        companyId: company.id,
        roles: { create: { role: { connect: { name: roleName } } } },
      },
      include: { company: true, roles: { include: { role: true } } },
    });
    await recordAudit({
      actionType: 'USER_REGISTERED',
      entityType: 'User',
      entityId: user.id,
      newValue: {
        email: user.email,
        companyId: user.companyId,
        status: user.status,
        registrationType: input.registrationType,
      },
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

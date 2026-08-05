import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app, resetAuthRateLimits } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { API, bearer, login, DEV_PASSWORD } from './integration/helpers';

/**
 * Regression tests for the security audit fixes.
 *
 * Each block pins a control that was missing rather than merely mis-tuned, so a revert shows up as a
 * failure here instead of as a quiet loss of protection:
 *  1. brute-force limiting on POST /auth/login (was: only the global 300/min traffic ceiling)
 *  2. the privileged-target guard on PATCH /users/:id/status (was: tenant scoping only)
 *  3. refresh-token family revocation on reuse (was: the replayed call failed, the descendant lived)
 */

/** Users created by this file, hard-deleted in afterAll so other suites see the seeded baseline. */
const createdUserIds: string[] = [];

async function companyIdByCode(code: string): Promise<string> {
  const c = await prisma.company.findFirstOrThrow({ where: { code } });
  return c.id;
}

/** Register → SA-approve → (optionally) promote to COMPANY_ADMIN. Returns the new user's id. */
async function createUser(
  saToken: string,
  opts: { email: string; companyId: string; promoteToAdmin?: boolean },
): Promise<string> {
  const reg = await request(app)
    .post(`${API}/auth/register`)
    .send({
      fullName: 'Audit Fixture',
      companyId: opts.companyId,
      email: opts.email,
      contactNumber: '9000000999',
      address: 'Somewhere, Pune',
      pinCode: '411099',
      distanceKm: 5,
      password: DEV_PASSWORD,
      confirmPassword: DEV_PASSWORD,
    });
  expect(reg.status).toBe(201);
  const id = reg.body.data.id as string;
  createdUserIds.push(id);

  await request(app)
    .patch(`${API}/users/${id}/approval`)
    .set(bearer(saToken))
    .send({ decision: 'APPROVE' })
    .expect(200);

  if (opts.promoteToAdmin) {
    await request(app)
      .post(`${API}/companies/${opts.companyId}/admins`)
      .set(bearer(saToken))
      .send({ userId: id })
      .expect(201);
  }
  return id;
}

let saToken: string;
let assentPeerAdminId: string;
let buildingAdminToken: string;
let seededSecurityId: string;

beforeAll(async () => {
  resetAuthRateLimits();
  saToken = await login('superadmin@redbricks.example');

  const assentId = await companyIdByCode('ASSENT');
  const redbricksId = await companyIdByCode('REDBRICKS');

  // A second COMPANY_ADMIN inside ASSENT — the "rival admin" case.
  assentPeerAdminId = await createUser(saToken, {
    email: 'audit-peer-admin@assent.example',
    companyId: assentId,
    promoteToAdmin: true,
  });

  // A COMPANY_ADMIN of the *building* company, which is where SECURITY accounts are filed
  // (auth.service BUILDING_COMPANY_CODE) — the case that could switch off every gate operator.
  const buildingAdminEmail = 'audit-building-admin@redbricks.example';
  await createUser(saToken, {
    email: buildingAdminEmail,
    companyId: redbricksId,
    promoteToAdmin: true,
  });
  buildingAdminToken = await login(buildingAdminEmail);

  const guard = await prisma.user.findFirstOrThrow({ where: { email: 'security@redbricks.example' } });
  seededSecurityId = guard.id;
});

afterAll(async () => {
  if (createdUserIds.length) {
    await prisma.companyAdmin.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  resetAuthRateLimits();
  await prisma.$disconnect();
});

describe('PATCH /users/:id/status — privileged-target guard', () => {
  it('refuses a COMPANY_ADMIN deactivating a peer COMPANY_ADMIN in the same company', async () => {
    const caToken = await login('admin@assent.example');
    const res = await request(app)
      .patch(`${API}/users/${assentPeerAdminId}/status`)
      .set(bearer(caToken))
      .send({ status: 'INACTIVE' });

    // 403, not 404: same tenant, so existence is not secret — only the action is refused.
    expect(res.status).toBe(403);
    const after = await prisma.user.findFirstOrThrow({ where: { id: assentPeerAdminId } });
    expect(after.status).toBe('ACTIVE');
  });

  it('refuses the building COMPANY_ADMIN deactivating a SECURITY gate operator', async () => {
    const res = await request(app)
      .patch(`${API}/users/${seededSecurityId}/status`)
      .set(bearer(buildingAdminToken))
      .send({ status: 'INACTIVE' });

    expect(res.status).toBe(403);
    const guard = await prisma.user.findFirstOrThrow({ where: { id: seededSecurityId } });
    expect(guard.status).toBe('ACTIVE');
  });

  it('still lets a COMPANY_ADMIN deactivate a plain employee in their own company', async () => {
    // The guard must not be over-broad: ordinary member management has to keep working.
    const caToken = await login('admin@assent.example');
    const employee = await prisma.user.findFirstOrThrow({ where: { email: 'sara@assent.example' } });

    await request(app)
      .patch(`${API}/users/${employee.id}/status`)
      .set(bearer(caToken))
      .send({ status: 'INACTIVE' })
      .expect(200);

    await request(app)
      .patch(`${API}/users/${employee.id}/status`)
      .set(bearer(caToken))
      .send({ status: 'ACTIVE' })
      .expect(200);
  });

  it('still lets the SUPER_ADMIN deactivate a COMPANY_ADMIN', async () => {
    await request(app)
      .patch(`${API}/users/${assentPeerAdminId}/status`)
      .set(bearer(saToken))
      .send({ status: 'INACTIVE' })
      .expect(200);

    await request(app)
      .patch(`${API}/users/${assentPeerAdminId}/status`)
      .set(bearer(saToken))
      .send({ status: 'ACTIVE' })
      .expect(200);
  });
});

describe('POST /auth/login — brute-force limiting', () => {
  beforeEach(() => {
    // The counters are per ip+email and live for 15 minutes; every test here starts from zero so
    // the assertions do not depend on what ran before them.
    resetAuthRateLimits();
  });

  it('blocks with 429 once the failed-attempt budget for an account is spent', async () => {
    const email = 'audit-bruteforce@assent.example';

    for (let i = 0; i < 10; i += 1) {
      const res = await request(app).post(`${API}/auth/login`).send({ email, password: 'wrong-password' });
      expect(res.status).toBe(401);
    }

    const blocked = await request(app).post(`${API}/auth/login`).send({ email, password: 'wrong-password' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('keys on the account, so one attacked address does not lock out another', async () => {
    for (let i = 0; i < 11; i += 1) {
      await request(app)
        .post(`${API}/auth/login`)
        .send({ email: 'audit-victim-a@assent.example', password: 'wrong-password' });
    }

    // A different email from the same IP still has its own budget.
    const other = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'audit-victim-b@assent.example', password: 'wrong-password' });
    expect(other.status).toBe(401);
  });

  it('does not count successful logins, so normal use is never throttled', async () => {
    for (let i = 0; i < 15; i += 1) {
      await request(app)
        .post(`${API}/auth/login`)
        .send({ email: 'admin@assent.example', password: DEV_PASSWORD })
        .expect(200);
    }
  });
});

describe('POST /auth/refresh — reuse revokes the token family', () => {
  beforeEach(() => {
    resetAuthRateLimits();
  });

  it('kills the descendant token when a rotated token is replayed', async () => {
    const first = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'aditi@assent.example', password: DEV_PASSWORD })
      .expect(200);
    const stolen = first.headers['set-cookie'];

    // The attacker redeems it first and receives a live descendant.
    const rotated = await request(app).post(`${API}/auth/refresh`).set('Cookie', stolen).expect(200);
    const descendant = rotated.headers['set-cookie'];

    // The victim's next refresh replays the now-rotated token — the theft signal.
    await request(app).post(`${API}/auth/refresh`).set('Cookie', stolen).expect(401);

    // The fix: the descendant the attacker holds is dead too, so the session cannot be continued.
    await request(app).post(`${API}/auth/refresh`).set('Cookie', descendant).expect(401);

    const audit = await prisma.auditLog.findFirst({
      where: { actionType: 'REFRESH_TOKEN_REUSE_DETECTED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
  });

  it('still rotates normally when a token is used exactly once', async () => {
    const first = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'rahul@assent.example', password: DEV_PASSWORD })
      .expect(200);

    const second = await request(app)
      .post(`${API}/auth/refresh`)
      .set('Cookie', first.headers['set-cookie'])
      .expect(200);

    await request(app).post(`${API}/auth/refresh`).set('Cookie', second.headers['set-cookie']).expect(200);
  });
});

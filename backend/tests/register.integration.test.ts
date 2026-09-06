import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { API, bearer, login, DEV_PASSWORD } from './integration/helpers';

/**
 * P4-20 — user registration. Proves the full chain: register (PENDING) → login blocked (403)
 * → Company-Admin approves → login works. Runs against the throwaway test DB (globalSetup).
 */

afterAll(async () => {
  await prisma.$disconnect();
});

async function assentId(): Promise<string> {
  const c = await prisma.company.findFirstOrThrow({ where: { code: 'ASSENT' } });
  return c.id;
}

describe('registration → approval → login', () => {
  it('creates a PENDING user who can log in only after Company-Admin approval', async () => {
    const email = 'newbie';
    const body = {
      fullName: 'New Bie',
      companyId: await assentId(),
      email,
      contactNumber: '9000000123',
      address: 'Somewhere, Pune',
      pinCode: '411099',
      distanceKm: 9.5,
      password: DEV_PASSWORD,
      confirmPassword: DEV_PASSWORD,
    };

    // 1. Register → 201, PENDING, and no session token is issued.
    const reg = await request(app).post(`${API}/auth/register`).send(body);
    expect(reg.status).toBe(201);
    expect(reg.body.data.status).toBe('PENDING');
    expect(reg.body.data.email).toBe(email);
    expect(reg.body.data.role).toBe('USER');
    expect(reg.body.data).not.toHaveProperty('accessToken');
    const newUserId = reg.body.data.id as string;

    // 2. Login is blocked while PENDING → 403.
    const blocked = await request(app).post(`${API}/auth/login`).send({ email, password: DEV_PASSWORD });
    expect(blocked.status).toBe(403);

    // 3. Company Admin (same company) approves.
    const caToken = await login('companyadmin');
    const approve = await request(app)
      .patch(`${API}/users/${newUserId}/approval`)
      .set(bearer(caToken))
      .send({ decision: 'APPROVE' });
    expect(approve.status).toBe(200);

    // 4. Login now succeeds → token + USER role.
    const ok = await request(app).post(`${API}/auth/login`).send({ email, password: DEV_PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.data.accessToken).toBeTruthy();
    expect(ok.body.data.user.role).toBe('USER');
  });

  it('rejects a duplicate email with 409', async () => {
    const res = await request(app).post(`${API}/auth/register`).send({
      fullName: 'Dupe',
      companyId: await assentId(),
      email: 'aditi', // seeded, active
      contactNumber: '9000000124',
      address: 'x, Pune',
      pinCode: '411100',
      password: DEV_PASSWORD,
      confirmPassword: DEV_PASSWORD,
    });
    expect(res.status).toBe(409);
  });

  it('rejects an unknown/inactive company with 400', async () => {
    const res = await request(app).post(`${API}/auth/register`).send({
      fullName: 'Ghost',
      companyId: 'does-not-exist',
      email: 'ghost',
      contactNumber: '9000000125',
      address: 'x, Pune',
      pinCode: '411101',
      password: DEV_PASSWORD,
      confirmPassword: DEV_PASSWORD,
    });
    expect(res.status).toBe(400);
  });

  it('rejects mismatched password confirmation with 400', async () => {
    const res = await request(app).post(`${API}/auth/register`).send({
      fullName: 'Mismatch',
      companyId: await assentId(),
      email: 'mismatch',
      contactNumber: '9000000126',
      address: 'x, Pune',
      pinCode: '411102',
      password: DEV_PASSWORD,
      confirmPassword: 'different#12345',
    });
    expect(res.status).toBe(400);
  });
});

/**
 * P4-21 — self-service company-admin registration (F11). A COMPANY_ADMIN request is PENDING,
 * approvable only by the Super Admin (a Company Admin gets 403), and approval both activates the
 * user and creates the CompanyAdmin assignment.
 */
describe('company-admin registration → super-admin approval', () => {
  it('is PENDING, CA cannot approve (403), SA approves + grants CompanyAdmin, then login works', async () => {
    const email = 'newcompanyadmin';
    const companyId = await assentId();
    const reg = await request(app).post(`${API}/auth/register`).send({
      fullName: 'New Admin',
      registrationType: 'COMPANY_ADMIN',
      companyId,
      email,
      contactNumber: '9000000127',
      address: 'Admin Rd, Pune',
      pinCode: '411103',
      password: DEV_PASSWORD,
      confirmPassword: DEV_PASSWORD,
    });
    expect(reg.status).toBe(201);
    expect(reg.body.data.status).toBe('PENDING');
    expect(reg.body.data.role).toBe('COMPANY_ADMIN');
    const newUserId = reg.body.data.id as string;

    // A Company Admin of the same company must NOT be able to approve an admin request → 403.
    const caToken = await login('companyadmin');
    const caApprove = await request(app)
      .patch(`${API}/users/${newUserId}/approval`)
      .set(bearer(caToken))
      .send({ decision: 'APPROVE' });
    expect(caApprove.status).toBe(403);

    // Still no CompanyAdmin row yet.
    expect(await prisma.companyAdmin.findUnique({
      where: { companyId_userId: { companyId, userId: newUserId } },
    })).toBeNull();

    // Super Admin approves → 200, and the CompanyAdmin assignment is created.
    const saToken = await login('superadmin');
    const saApprove = await request(app)
      .patch(`${API}/users/${newUserId}/approval`)
      .set(bearer(saToken))
      .send({ decision: 'APPROVE' });
    expect(saApprove.status).toBe(200);
    expect(saApprove.body.data.status).toBe('ACTIVE');
    expect(await prisma.companyAdmin.findUnique({
      where: { companyId_userId: { companyId, userId: newUserId } },
    })).not.toBeNull();

    // Login now works with the COMPANY_ADMIN role.
    const ok = await request(app).post(`${API}/auth/login`).send({ email, password: DEV_PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.data.user.role).toBe('COMPANY_ADMIN');
    expect(ok.body.data.user.companyId).toBe(companyId);
  });

  it('exposes pending company-admin requests to the SA queue only (CA → 403)', async () => {
    const email = 'queue-companyadmin';
    const reg = await request(app).post(`${API}/auth/register`).send({
      fullName: 'Queue Admin',
      registrationType: 'COMPANY_ADMIN',
      companyId: await assentId(),
      email,
      contactNumber: '9000000128',
      address: 'Queue St, Pune',
      pinCode: '411104',
      password: DEV_PASSWORD,
      confirmPassword: DEV_PASSWORD,
    });
    expect(reg.status).toBe(201);

    // Super Admin sees the request in the queue.
    const saToken = await login('superadmin');
    const queue = await request(app).get(`${API}/users/pending-admins`).set(bearer(saToken));
    expect(queue.status).toBe(200);
    const emails = (queue.body.data as Array<{ email: string; role: string }>).map((u) => u.email);
    expect(emails).toContain(email);
    // The queue is every *privileged* pending registration, which since Phase 7 (D15) also means
    // SECURITY — both are super-admin approved. Asserting COMPANY_ADMIN only would fail the moment a
    // guard is awaiting approval.
    expect(
      queue.body.data.every((u: { role: string }) => ['COMPANY_ADMIN', 'SECURITY'].includes(u.role)),
    ).toBe(true);

    // A Company Admin cannot read the queue → 403.
    const caToken = await login('companyadmin');
    const forbidden = await request(app).get(`${API}/users/pending-admins`).set(bearer(caToken));
    expect(forbidden.status).toBe(403);
  });
});

/**
 * Phase 7 (D15) — SECURITY registration. A gate operator is a building-wide guard, not a tenant's
 * employee: they pick no company, and no home address / PIN / commute distance is collected. The
 * server files them under the building company (code REDBRICKS) and only the Super Admin approves.
 */
describe('security registration → super-admin approval', () => {
  const buildingCompany = () => prisma.company.findFirstOrThrow({ where: { code: 'REDBRICKS' } });

  it('accepts name/number/email/password alone, files the guard under the building company, then SA approves', async () => {
    const email = 'guard2';
    const reg = await request(app).post(`${API}/auth/register`).send({
      fullName: 'Gate Guard Two',
      registrationType: 'SECURITY',
      email,
      contactNumber: '9000000200',
      password: DEV_PASSWORD,
      confirmPassword: DEV_PASSWORD,
    });
    // No companyId, address or pinCode sent at all — this is the whole point of the persona.
    expect(reg.status).toBe(201);
    expect(reg.body.data.status).toBe('PENDING');
    expect(reg.body.data.role).toBe('SECURITY');
    const building = await buildingCompany();
    expect(reg.body.data.companyId).toBe(building.id);
    const userId = reg.body.data.id as string;

    // Login blocked while PENDING.
    const blocked = await request(app).post(`${API}/auth/login`).send({ email, password: DEV_PASSWORD });
    expect(blocked.status).toBe(403);

    // A Company Admin must not be able to approve a guard. This is a 404 rather than the 403 an admin
    // request gets: the guard sits under the building company, so a tenant admin cannot even see the
    // record (cross-tenant existence is deliberately hidden). Two independent guards both deny it.
    const caToken = await login('companyadmin');
    const caApprove = await request(app)
      .patch(`${API}/users/${userId}/approval`)
      .set(bearer(caToken))
      .send({ decision: 'APPROVE' });
    expect(caApprove.status).toBe(404);

    // The guard shows up in the Super Admin's privileged-registration queue.
    const saToken = await login('superadmin');
    const queue = await request(app).get(`${API}/users/pending-admins`).set(bearer(saToken));
    expect(queue.status).toBe(200);
    expect((queue.body.data as Array<{ email: string }>).map((u) => u.email)).toContain(email);

    // SA approval simply activates: unlike a COMPANY_ADMIN request it grants no CompanyAdmin row.
    const approve = await request(app)
      .patch(`${API}/users/${userId}/approval`)
      .set(bearer(saToken))
      .send({ decision: 'APPROVE' });
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe('ACTIVE');
    expect(
      await prisma.companyAdmin.findUnique({
        where: { companyId_userId: { companyId: building.id, userId } },
      }),
    ).toBeNull();

    // Login now works and carries the SECURITY role, which is what gates the gate console.
    const ok = await request(app).post(`${API}/auth/login`).send({ email, password: DEV_PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.data.user.role).toBe('SECURITY');
    expect(ok.body.data.user.companyId).toBe(building.id);
  });

  it('ignores company/address/PIN/distance if a client sends them anyway', async () => {
    const assent = await prisma.company.findFirstOrThrow({ where: { code: 'ASSENT' } });
    const reg = await request(app).post(`${API}/auth/register`).send({
      fullName: 'Gate Guard Three',
      registrationType: 'SECURITY',
      email: 'guard3',
      contactNumber: '9000000201',
      companyId: assent.id, // a tenant — must NOT win
      address: 'Should be ignored',
      pinCode: '411105',
      distanceKm: 12,
      password: DEV_PASSWORD,
      confirmPassword: DEV_PASSWORD,
    });
    expect(reg.status).toBe(201);
    const building = await buildingCompany();
    // The building company is resolved server-side, so a guard cannot be filed under a tenant.
    expect(reg.body.data.companyId).toBe(building.id);
    expect(reg.body.data.address).toBe('');
    expect(reg.body.data.pinCode).toBe('');
    // A guard is never allocated a slot, so never carries a scoring distance.
    expect(reg.body.data.distanceKm).toBeNull();
  });

  it('still requires company/address/PIN from an EMPLOYEE', async () => {
    const res = await request(app).post(`${API}/auth/register`).send({
      fullName: 'No Company',
      registrationType: 'EMPLOYEE',
      email: 'nocompany',
      contactNumber: '9000000202',
      password: DEV_PASSWORD,
      confirmPassword: DEV_PASSWORD,
    });
    expect(res.status).toBe(400);
    const fields = (res.body.error.details as Array<{ field: string }>).map((d) => d.field);
    // Relaxing the contract for SECURITY must not have relaxed it for everyone.
    expect(fields).toEqual(expect.arrayContaining(['companyId', 'address', 'pinCode']));
  });
});

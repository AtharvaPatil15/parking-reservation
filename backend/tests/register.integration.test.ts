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
    const email = 'newbie@assent.example';
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
    const caToken = await login('admin@assent.example');
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
      email: 'aditi@assent.example', // seeded, active
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
      email: 'ghost@nowhere.example',
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
      email: 'mismatch@assent.example',
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
    const email = 'newadmin@assent.example';
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
    const caToken = await login('admin@assent.example');
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
    const saToken = await login('superadmin@redbricks.example');
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
    const email = 'queue-admin@assent.example';
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
    const saToken = await login('superadmin@redbricks.example');
    const queue = await request(app).get(`${API}/users/pending-admins`).set(bearer(saToken));
    expect(queue.status).toBe(200);
    const emails = (queue.body.data as Array<{ email: string; role: string }>).map((u) => u.email);
    expect(emails).toContain(email);
    expect(queue.body.data.every((u: { role: string }) => u.role === 'COMPANY_ADMIN')).toBe(true);

    // A Company Admin cannot read the queue → 403.
    const caToken = await login('admin@assent.example');
    const forbidden = await request(app).get(`${API}/users/pending-admins`).set(bearer(caToken));
    expect(forbidden.status).toBe(403);
  });
});

import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { API, bearer, login, DEV_PASSWORD } from './integration/helpers';

/**
 * GET /users/admin-requests/history — the Super Admin's approval history (F11): company-admin
 * requests already decided (ACTIVE/REJECTED), so outcomes aren't lost once they leave the queue.
 */
afterAll(async () => {
  await prisma.$disconnect();
});

async function assentId(): Promise<string> {
  return (await prisma.company.findFirstOrThrow({ where: { code: 'ASSENT' } })).id;
}

describe('admin-request approval history', () => {
  it('lists a company-admin request once the Super Admin has approved it', async () => {
    const email = 'history-admin@assent.example';
    const reg = await request(app).post(`${API}/auth/register`).send({
      fullName: 'History Admin',
      registrationType: 'COMPANY_ADMIN',
      companyId: await assentId(),
      email,
      contactNumber: '9000000200',
      address: 'Hist Rd, Pune',
      pinCode: '411200',
      password: DEV_PASSWORD,
      confirmPassword: DEV_PASSWORD,
    });
    expect(reg.status).toBe(201);
    const userId = reg.body.data.id as string;

    const sa = await login('superadmin@redbricks.example');

    // Still PENDING → not in the processed history yet.
    const before = await request(app).get(`${API}/users/admin-requests/history`).set(bearer(sa));
    expect(before.status).toBe(200);
    expect((before.body.data as Array<{ email: string }>).map((u) => u.email)).not.toContain(email);

    // Approve → the request is now processed and appears in the history as ACTIVE.
    const approve = await request(app)
      .patch(`${API}/users/${userId}/approval`)
      .set(bearer(sa))
      .send({ decision: 'APPROVE' });
    expect(approve.status).toBe(200);

    const after = await request(app).get(`${API}/users/admin-requests/history`).set(bearer(sa));
    expect(after.status).toBe(200);
    const row = (after.body.data as Array<{ email: string; status: string; role: string }>).find(
      (u) => u.email === email,
    );
    expect(row).toBeTruthy();
    expect(row?.status).toBe('ACTIVE');
    expect(row?.role).toBe('COMPANY_ADMIN');
  });

  it('forbids a Company Admin from reading the approval history (403)', async () => {
    const ca = await login('admin@assent.example');
    const res = await request(app).get(`${API}/users/admin-requests/history`).set(bearer(ca));
    expect(res.status).toBe(403);
  });
});

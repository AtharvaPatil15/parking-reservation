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
      contactNumber: '+91-9000000123',
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
      contactNumber: '+91-9000000124',
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
      contactNumber: '+91-9000000125',
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
      contactNumber: '+91-9000000126',
      address: 'x, Pune',
      pinCode: '411102',
      password: DEV_PASSWORD,
      confirmPassword: 'different#12345',
    });
    expect(res.status).toBe(400);
  });
});

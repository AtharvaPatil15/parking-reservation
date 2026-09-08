import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { API, bearer, login } from './integration/helpers';

/**
 * POST /parking-areas — Super Admin creates an area (e.g. Basement 2) to allocate slots into.
 * The area is attached to the configured office location server-side. Runs against the test DB.
 */
afterAll(async () => {
  await prisma.$disconnect();
});

describe('parking areas', () => {
  it('lets the Super Admin create an area that then appears in the list', async () => {
    const sa = await login('superadmin');

    const created = await request(app)
      .post(`${API}/parking-areas`)
      .set(bearer(sa))
      .send({ name: 'Basement 99', floor: 'B99' });
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe('Basement 99');
    expect(created.body.data.officeLocationId).toBeTruthy();

    const list = await request(app).get(`${API}/parking-areas`).set(bearer(sa));
    expect(list.status).toBe(200);
    expect((list.body.data as Array<{ name: string }>).map((a) => a.name)).toContain('Basement 99');
  });

  it('rejects a missing name with 400', async () => {
    const sa = await login('superadmin');
    const res = await request(app).post(`${API}/parking-areas`).set(bearer(sa)).send({ floor: 'B1' });
    expect(res.status).toBe(400);
  });

  it('forbids a Company Admin from creating an area (403)', async () => {
    const ca = await login('companyadmin');
    const res = await request(app).post(`${API}/parking-areas`).set(bearer(ca)).send({ name: 'Basement CA' });
    expect(res.status).toBe(403);
  });
});

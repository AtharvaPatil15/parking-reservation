import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { API, bearer, login } from './integration/helpers';

/**
 * Deleting a slot is a SOFT delete (sets deletedAt), and the unique constraint on
 * (parkingAreaId, slotNumber) spans soft-deleted rows. Re-adding a deleted number therefore used to
 * 409. createSlot now revives the dead row instead, so a Super Admin can reuse a number after
 * deleting it — the same physical slot coming back into service.
 */
const PREFIX = 'RECREATE-';
const AREA_NAME = 'RECREATE Area';

async function cleanup(): Promise<void> {
  await prisma.parkingSlot.deleteMany({ where: { slotNumber: { startsWith: PREFIX } } });
  await prisma.parkingArea.deleteMany({ where: { name: AREA_NAME } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('slot delete then re-create', () => {
  it('allows re-creating a slot number after it was deleted (revives, no 409)', async () => {
    const sa = await login('superadmin');

    const area = await request(app).post(`${API}/parking-areas`).set(bearer(sa)).send({ name: AREA_NAME });
    expect(area.status).toBe(201);
    const parkingAreaId = area.body.data.id as string;

    const first = await request(app)
      .post(`${API}/slots`)
      .set(bearer(sa))
      .send({ slotNumber: `${PREFIX}1`, parkingAreaId });
    expect(first.status).toBe(201);
    const firstId = first.body.data.id as string;

    const del = await request(app).delete(`${API}/slots/${firstId}`).set(bearer(sa));
    expect(del.status).toBe(200);

    // Re-creating the same number must succeed now (previously 409 against the soft-deleted row).
    const again = await request(app)
      .post(`${API}/slots`)
      .set(bearer(sa))
      .send({ slotNumber: `${PREFIX}1`, parkingAreaId });
    expect(again.status).toBe(201);
    expect(again.body.data.status).toBe('AVAILABLE');
    expect(again.body.data.id).toBe(firstId); // the dead row was revived, not duplicated

    // The list shows the slot exactly once and active again.
    const list = await request(app).get(`${API}/slots`).query({ page: 1, pageSize: 100 }).set(bearer(sa));
    const mine = (list.body.data as Array<{ slotNumber: string; status: string }>).filter((s) =>
      s.slotNumber.startsWith(PREFIX),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].status).toBe('AVAILABLE');
  });

  it('still 409s when the number is currently active (a real duplicate)', async () => {
    const sa = await login('superadmin');
    const area = await request(app).post(`${API}/parking-areas`).set(bearer(sa)).send({ name: AREA_NAME });
    const parkingAreaId = area.body.data.id as string;

    const a = await request(app).post(`${API}/slots`).set(bearer(sa)).send({ slotNumber: `${PREFIX}DUP`, parkingAreaId });
    expect(a.status).toBe(201);
    const dup = await request(app).post(`${API}/slots`).set(bearer(sa)).send({ slotNumber: `${PREFIX}DUP`, parkingAreaId });
    expect(dup.status).toBe(409);
  });
});

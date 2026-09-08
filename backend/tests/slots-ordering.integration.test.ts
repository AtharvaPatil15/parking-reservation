import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { API, bearer, login } from './integration/helpers';

/**
 * GET /slots ordering contract. The list is deliberately newest-first — `orderBy: [{ createdAt:
 * 'desc' }, { slotNumber: 'asc' }]` in slots.service.ts — so a just-created slot lands at the top of
 * page 1. This pins that behaviour (primary createdAt desc + slotNumber-asc tiebreak) so it can't be
 * silently flipped back, since every consumer of GET /slots depends on it.
 */
const PREFIX = 'ORDTEST-';
const AREA_NAME = 'ORDTEST Area';

async function cleanup(): Promise<void> {
  await prisma.parkingSlot.deleteMany({ where: { slotNumber: { startsWith: PREFIX } } });
  await prisma.parkingArea.deleteMany({ where: { name: AREA_NAME } });
}

beforeAll(cleanup); // clear any fixtures a crashed prior run may have left behind
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('GET /slots ordering', () => {
  it('returns slots newest-first (createdAt desc), with slotNumber asc breaking ties', async () => {
    const sa = await login('superadmin');

    const area = await request(app).post(`${API}/parking-areas`).set(bearer(sa)).send({ name: AREA_NAME });
    expect(area.status).toBe(201);
    const parkingAreaId = area.body.data.id as string;

    const make = async (slotNumber: string): Promise<string> => {
      const res = await request(app).post(`${API}/slots`).set(bearer(sa)).send({ slotNumber, parkingAreaId });
      expect(res.status).toBe(201);
      return res.body.data.id as string;
    };
    const idA = await make(`${PREFIX}A`);
    const idM = await make(`${PREFIX}M`);
    const idZ = await make(`${PREFIX}Z`);

    // Stamp deterministic timestamps so the assertion can't flake on clock granularity. M and Z share
    // the newest instant to force the slotNumber-asc tiebreak; A is older. Future dates keep all three
    // at the top of the newest-first list regardless of seeded slots.
    const older = new Date('2999-01-01T00:00:00.000Z');
    const newer = new Date('2999-01-02T00:00:00.000Z');
    await prisma.parkingSlot.update({ where: { id: idA }, data: { createdAt: older } });
    await prisma.parkingSlot.update({ where: { id: idM }, data: { createdAt: newer } });
    await prisma.parkingSlot.update({ where: { id: idZ }, data: { createdAt: newer } });

    const list = await request(app).get(`${API}/slots`).query({ page: 1, pageSize: 100 }).set(bearer(sa));
    expect(list.status).toBe(200);
    const ordered = (list.body.data as Array<{ slotNumber: string }>)
      .map((s) => s.slotNumber)
      .filter((n) => n.startsWith(PREFIX));

    // newer group (M, Z) by slotNumber asc, then the older slot (A). This order is unique to
    // createdAt-desc — createdAt-asc or a plain slotNumber-asc sort would both yield [A, M, Z].
    expect(ordered).toEqual([`${PREFIX}M`, `${PREFIX}Z`, `${PREFIX}A`]);
  });
});

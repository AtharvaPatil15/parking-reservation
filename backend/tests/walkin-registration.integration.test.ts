import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { API, bearer, login, resetTransactional } from './integration/helpers';

/**
 * Walk-in vehicle registration + the gate capacity panel (2026-08-05).
 *
 * The behaviour under test is the one that reverses a Phase 7 rule: a car with an outstanding
 * registration is **refused** at the barrier. D16 ("never block the barrier") still governs the path it
 * came from — an unrecognised plate nobody registered is recorded and admitted — so both halves are
 * asserted here, together, because the distinction is the whole design.
 */

const SECURITY = 'security1';
const CA = 'companyadmin';
const SA = 'superadmin';
const PLATE = 'MH14ZZ7788';

async function assentId(): Promise<string> {
  const c = await prisma.company.findFirstOrThrow({ where: { code: 'ASSENT' } });
  return c.id;
}

async function registerWalkIn(
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, never> & { data?: Record<string, string>; error?: { message: string } } }> {
  const token = await login(SECURITY);
  const res = await request(app)
    .post(`${API}/vehicles/registrations`)
    .set(bearer(token))
    .send({
      vehicleNumber: PLATE,
      ownerName: 'Nikhil Rao',
      contactNumber: '9876500011',
      companyId: await assentId(),
      ...overrides,
    });
  return res as never;
}

async function checkIn(plate = PLATE) {
  const token = await login(SECURITY);
  return request(app).post(`${API}/gate/check-in`).set(bearer(token)).send({ vehicleNumber: plate });
}

async function lookup(plate = PLATE) {
  const token = await login(SECURITY);
  return request(app).get(`${API}/vehicles/lookup`).query({ number: plate }).set(bearer(token));
}

async function decide(id: string, decision: 'APPROVE' | 'REJECT', as = CA) {
  const token = await login(as);
  return request(app)
    .post(`${API}/vehicles/registrations/${id}/decision`)
    .set(bearer(token))
    .send({ decision });
}

beforeEach(async () => {
  // Clears gate events and registration requests too, so a held plate never leaks into the next test.
  await resetTransactional();
  // Vehicles are registry data, not transactional — an approval creates one, so remove it explicitly.
  await prisma.vehicle.deleteMany({ where: { vehicleNumber: PLATE } });
});

afterEach(async () => {
  await prisma.vehicle.deleteMany({ where: { vehicleNumber: PLATE } });
});

describe('a walk-in car waits for approval', () => {
  it('is refused at the gate while pending, and admitted once approved', async () => {
    const created = await registerWalkIn();
    expect(created.status).toBe(201);
    const id = created.body.data!.id;
    expect(created.body.data!.status).toBe('PENDING');

    // The lookup names who has to approve, so the guard knows who to call rather than just seeing a
    // greyed-out button.
    const held = await lookup();
    expect(held.body.data.pendingRegistration).toMatchObject({ ownerName: 'Nikhil Rao' });
    expect(held.body.data.pendingRegistration.companyName).toBeTruthy();

    // The one case the gate refuses a car.
    const refused = await checkIn();
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/waiting for .* to approve/i);
    expect(await prisma.gateEvent.count({ where: { vehicleNumber: PLATE } })).toBe(0);

    const approved = await decide(id, 'APPROVE');
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('APPROVED');

    // Approval is what creates the registry row — the decision and its effect are one transaction, so an
    // APPROVED request can never exist without the car it promised.
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { vehicleNumber: PLATE } });
    expect(vehicle.isActive).toBe(true);
    expect(approved.body.data.vehicleId).toBe(vehicle.id);

    const admitted = await checkIn();
    expect(admitted.status).toBe(201);
    // Known car now, but with no booking for today — so it is still a D16 unbooked entry.
    expect(admitted.body.data.hadBooking).toBe(false);
    expect(admitted.body.data.ownerName).toBe('Nikhil Rao');
  });

  it('still lets an unregistered car straight in — D16 is intact for the path nobody registered', async () => {
    // The guard's out: a contractor is not a new employee, so they simply do not register them.
    const res = await checkIn('MH01VISITOR9');
    expect(res.status).toBe(201);
    expect(res.body.data.hadBooking).toBe(false);
  });

  it('leaves the registry untouched when rejected, and does not re-decide', async () => {
    const created = await registerWalkIn();
    const id = created.body.data!.id;

    const rejected = await decide(id, 'REJECT');
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('REJECTED');
    expect(await prisma.vehicle.count({ where: { vehicleNumber: PLATE } })).toBe(0);

    // Only a PENDING request can be decided — a second decision is a 400, not a silent overwrite.
    const again = await decide(id, 'APPROVE');
    expect(again.status).toBe(400);

    // A rejection is about registry membership, not a permanent ban: with no pending request the plate
    // falls back to the unregistered path and can be recorded as a visitor.
    const res = await checkIn();
    expect(res.status).toBe(201);
  });

  it('links the car to an existing account when the username matches', async () => {
    const created = await registerWalkIn({ ownerEmail: 'aditi' });
    await decide(created.body.data!.id, 'APPROVE');

    const aditi = await prisma.user.findFirstOrThrow({ where: { email: 'aditi' } });
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { vehicleNumber: PLATE } });
    // Without this link the gate cannot find the driver's booking from their plate.
    expect(vehicle.userId).toBe(aditi.id);
  });

  it('refuses a duplicate request and a plate that is already registered', async () => {
    await registerWalkIn();
    const duplicate = await registerWalkIn();
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error!.message).toMatch(/already waiting/i);

    const created = await prisma.vehicleRegistrationRequest.findFirstOrThrow({ where: { vehicleNumber: PLATE } });
    await decide(created.id, 'APPROVE');

    const alreadyRegistered = await registerWalkIn();
    expect(alreadyRegistered.status).toBe(409);
    expect(alreadyRegistered.body.error!.message).toMatch(/already registered/i);
  });

  it('requires a company — there is nobody to approve it otherwise', async () => {
    const res = await registerWalkIn({ companyId: undefined });
    expect(res.status).toBe(400);
  });
});

describe('who may decide a registration', () => {
  it('lets the super admin decide any company’s request', async () => {
    const created = await registerWalkIn();
    const res = await decide(created.body.data!.id, 'APPROVE', SA);
    expect(res.status).toBe(200);
  });

  it('refuses a company admin another tenant’s request', async () => {
    // Register against a company Assent's admin has nothing to do with, rather than moving the seeded
    // admin between tenants — a half-applied fixture mutation would poison the rest of the suite.
    const other = await prisma.company.create({
      data: { name: 'Other Tenant Ltd', code: `OTHER${Date.now()}` },
    });
    try {
      const created = await registerWalkIn({ companyId: other.id });
      expect(created.status).toBe(201);

      const res = await decide(created.body.data!.id, 'APPROVE'); // as Assent's admin
      expect(res.status).toBe(403);
      // Still pending — a refused decision must not half-apply.
      const row = await prisma.vehicleRegistrationRequest.findUniqueOrThrow({
        where: { id: created.body.data!.id },
      });
      expect(row.status).toBe('PENDING');
    } finally {
      await prisma.vehicleRegistrationRequest.deleteMany({ where: { companyId: other.id } });
      await prisma.company.delete({ where: { id: other.id } });
    }
  });

  it('does not let security decide their own request', async () => {
    const created = await registerWalkIn();
    const token = await login(SECURITY);
    const res = await request(app)
      .post(`${API}/vehicles/registrations/${created.body.data!.id}/decision`)
      .set(bearer(token))
      .send({ decision: 'APPROVE' });
    // The entire point of the feature: the guard asks, somebody else decides.
    expect(res.status).toBe(403);
  });

  it('shows security only their own submissions', async () => {
    await registerWalkIn();
    const token = await login(SECURITY);
    const res = await request(app).get(`${API}/vehicles/registrations`).set(bearer(token)).expect(200);
    // Scoped to what they raised — they need it, because the car is waiting on the answer.
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].vehicleNumber).toBe(PLATE);
  });
});

describe('gate capacity', () => {
  it('reports per-company slots, demand and what is still free', async () => {
    const token = await login(SECURITY);
    const res = await request(app).get(`${API}/gate/capacity`).set(bearer(token)).expect(200);

    const assent = res.body.data.rows.find(
      (r: { companyName: string }) => r.companyName.toLowerCase().includes('assent'),
    );
    expect(assent).toBeDefined();
    // The identity the panel is built on — break it and the guard reads a row that does not add up.
    expect(assent.free).toBe(Math.max(0, assent.slots - assent.blocked - assent.allocated));
    expect(res.body.data.building.totalSlots).toBeGreaterThan(0);
    expect(res.body.data.bookingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('counts a checked-in car as inside, without changing what is free', async () => {
    const before = await request(app)
      .get(`${API}/gate/capacity`)
      .set(bearer(await login(SECURITY)))
      .expect(200);

    await checkIn('MH01FRESH123');

    const after = await request(app)
      .get(`${API}/gate/capacity`)
      .set(bearer(await login(SECURITY)))
      .expect(200);

    // An unregistered car belongs to no company, so it lands in the building total only — reported
    // separately rather than hidden, which is why the total can exceed the sum of the rows.
    expect(after.body.data.building.inside).toBe(before.body.data.building.inside + 1);
    expect(after.body.data.building.insideUnattributed).toBe(
      before.body.data.building.insideUnattributed + 1,
    );
    // `free` is quota-relative: arriving does not free or consume a slot, the allocation did that.
    expect(after.body.data.building.free).toBe(before.body.data.building.free);
  });

  it('is not readable by a company admin — it is building-wide (D15)', async () => {
    const token = await login(CA);
    await request(app).get(`${API}/gate/capacity`).set(bearer(token)).expect(403);
  });
});

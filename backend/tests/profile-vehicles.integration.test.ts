import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { API, bearer, login, resetTransactional } from './integration/helpers';

beforeEach(async () => {
  await resetTransactional();
  await prisma.gateEvent.deleteMany({});
  await prisma.vehicle.deleteMany({ where: { vehicleNumber: { in: ['KA051234', 'KA059999'] } } });
});

describe('profile vehicles', () => {
  it('lets a user manage cars and exposes active cars to security lookup', async () => {
    const user = await login('aditi@assent.example');
    const guard = await login('security@redbricks.example');

    const created = await request(app)
      .post(`${API}/me/vehicles`)
      .set(bearer(user))
      .send({ vehicleNumber: 'KA 05 1234', makeModel: 'Honda City', colour: 'Silver' })
      .expect(201);

    expect(created.body.data.vehicleNumber).toBe('KA051234');
    expect(created.body.data.ownerEmail).toBe('aditi@assent.example');

    const mine = await request(app).get(`${API}/me/vehicles`).set(bearer(user)).expect(200);
    expect(mine.body.data.map((v: { vehicleNumber: string }) => v.vehicleNumber)).toContain('KA051234');

    const lookup = await request(app)
      .get(`${API}/vehicles/lookup`)
      .query({ number: 'ka-05-1234' })
      .set(bearer(guard))
      .expect(200);
    expect(lookup.body.data.known).toBe(true);
    expect(lookup.body.data.vehicle.ownerEmail).toBe('aditi@assent.example');

    await request(app).delete(`${API}/me/vehicles/${created.body.data.id}`).set(bearer(user)).expect(200);

    const afterRemove = await request(app)
      .get(`${API}/vehicles/lookup`)
      .query({ number: 'KA051234' })
      .set(bearer(guard))
      .expect(200);
    expect(afterRemove.body.data.known).toBe(false);
  });

  it('does not let a user take another active user car number', async () => {
    const aditi = await login('aditi@assent.example');
    const rahul = await login('rahul@assent.example');

    await request(app).post(`${API}/me/vehicles`).set(bearer(aditi)).send({ vehicleNumber: 'KA 05 9999' }).expect(201);

    const duplicate = await request(app)
      .post(`${API}/me/vehicles`)
      .set(bearer(rahul))
      .send({ vehicleNumber: 'ka-05-9999' });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.message).toMatch(/already registered/i);
  });
});

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { API, bearer, futureBookableDate, login, resetTransactional } from './integration/helpers';

const SCRATCH_PLATES = ['KA051234', 'KA059999', 'KA057777', 'DL01ZZ0001', 'DL01ZZ0002'];

beforeEach(async () => {
  await resetTransactional();
  await prisma.gateEvent.deleteMany({});
  await prisma.vehicle.deleteMany({ where: { vehicleNumber: { in: SCRATCH_PLATES } } });
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

  it('edits a saved car, and security sees the new details', async () => {
    const user = await login('aditi@assent.example');
    const guard = await login('security@redbricks.example');

    const created = await request(app)
      .post(`${API}/me/vehicles`)
      .set(bearer(user))
      .send({ vehicleNumber: 'KA 05 1234', makeModel: 'Honda City', colour: 'Silver' })
      .expect(201);

    const edited = await request(app)
      .patch(`${API}/me/vehicles/${created.body.data.id}`)
      .set(bearer(user))
      .send({ makeModel: 'Hyundai i20', colour: null, vehicleType: 'EV_CAR' })
      .expect(200);

    expect(edited.body.data).toMatchObject({
      id: created.body.data.id,
      vehicleNumber: 'KA051234', // untouched fields stay put
      makeModel: 'Hyundai i20',
      colour: null, // explicit null clears
      vehicleType: 'EV_CAR',
    });

    const lookup = await request(app)
      .get(`${API}/vehicles/lookup`)
      .query({ number: 'KA051234' })
      .set(bearer(guard))
      .expect(200);
    expect(lookup.body.data.vehicle.makeModel).toBe('Hyundai i20');
  });

  it('changes the car number itself, moving what security can find', async () => {
    const user = await login('aditi@assent.example');
    const guard = await login('security@redbricks.example');

    const created = await request(app)
      .post(`${API}/me/vehicles`)
      .set(bearer(user))
      .send({ vehicleNumber: 'DL 01 ZZ 0001' })
      .expect(201);

    const edited = await request(app)
      .patch(`${API}/me/vehicles/${created.body.data.id}`)
      .set(bearer(user))
      .send({ vehicleNumber: 'dl-01-zz-0002' })
      .expect(200);

    expect(edited.body.data.vehicleNumber).toBe('DL01ZZ0002');
    // The display form must follow the number, or the list keeps advertising the old plate.
    expect(edited.body.data.displayNumber).toBe('DL-01-ZZ-0002');

    const oldPlate = await request(app).get(`${API}/vehicles/lookup`).query({ number: 'DL01ZZ0001' }).set(bearer(guard));
    expect(oldPlate.body.data.known).toBe(false);
    const newPlate = await request(app).get(`${API}/vehicles/lookup`).query({ number: 'DL01ZZ0002' }).set(bearer(guard));
    expect(newPlate.body.data.known).toBe(true);
  });

  it('refuses an edit that would take another user\'s car number, and 404s someone else\'s car', async () => {
    const aditi = await login('aditi@assent.example');
    const rahul = await login('rahul@assent.example');

    const mine = await request(app).post(`${API}/me/vehicles`).set(bearer(aditi)).send({ vehicleNumber: 'KA 05 1234' }).expect(201);
    await request(app).post(`${API}/me/vehicles`).set(bearer(rahul)).send({ vehicleNumber: 'KA 05 9999' }).expect(201);

    // Same 409 story as create — that is the point of sharing the guard.
    const clash = await request(app)
      .patch(`${API}/me/vehicles/${mine.body.data.id}`)
      .set(bearer(aditi))
      .send({ vehicleNumber: 'ka 05 9999' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toMatch(/already registered/i);

    // And the original is unchanged by the failed attempt.
    await expect(prisma.vehicle.findUniqueOrThrow({ where: { vehicleNumber: 'KA051234' } })).resolves.toBeTruthy();

    // Editing a car you do not own is a 404, not a 403 — you cannot enumerate other people's cars.
    await request(app).patch(`${API}/me/vehicles/${mine.body.data.id}`).set(bearer(rahul)).send({ colour: 'Red' }).expect(404);
  });

  /**
   * The gap this closes: a plate typed straight into the booking form used to live only as a
   * BookingRequest snapshot. The gate keys its typeahead on the Vehicle table and only renders the
   * driver / slot for a recognised plate, so an unsaved car arrived looking like a stranger.
   */
  describe('a booking registers its car so security can find it', () => {
    const DATE = futureBookableDate();

    it('adds a freely-typed car number to the profile and the registry', async () => {
      const user = await login('aditi@assent.example');
      const guard = await login('security@redbricks.example');

      const before = await request(app).get(`${API}/me/vehicles`).set(bearer(user)).expect(200);
      expect(before.body.data.map((v: { vehicleNumber: string }) => v.vehicleNumber)).not.toContain('KA057777');

      await request(app)
        .post(`${API}/bookings`)
        .set(bearer(user))
        .send({ bookingDate: DATE, vehicleType: 'CAR', vehicleNumber: 'ka 05 7777', carpoolPeople: 1 })
        .expect(201);

      // Saved against the profile, normalized, with the typed form kept for display.
      const after = await request(app).get(`${API}/me/vehicles`).set(bearer(user)).expect(200);
      const saved = after.body.data.find((v: { vehicleNumber: string }) => v.vehicleNumber === 'KA057777');
      expect(saved).toBeTruthy();
      expect(saved.displayNumber).toBe('KA 05 7777');

      // …which is the whole point: the plate is now a recognised one, so the gate console resolves the
      // driver instead of showing "Not in the vehicle registry" with no name and no slot.
      // (`hasBooking` is deliberately not asserted here: lookup only ever matches TODAY's booking, and
      // the booking window starts in the future, so it is legitimately false.)
      const lookup = await request(app)
        .get(`${API}/vehicles/lookup`)
        .query({ number: 'KA-05-7777' })
        .set(bearer(guard))
        .expect(200);
      expect(lookup.body.data.known).toBe(true);
      expect(lookup.body.data.vehicle.ownerEmail).toBe('aditi@assent.example');
      expect(lookup.body.data.vehicle.ownerName).toBe('Aditi Rao');

      // And the typeahead can now find it, which is how the guard gets to it without the exact plate.
      const search = await request(app).get(`${API}/vehicles`).query({ search: 'KA057777' }).set(bearer(guard)).expect(200);
      expect(search.body.data.map((v: { vehicleNumber: string }) => v.vehicleNumber)).toContain('KA057777');
    });

    it('still books when the car belongs to someone else, without registering it', async () => {
      const aditi = await login('aditi@assent.example');
      const rahul = await login('rahul@assent.example');
      await request(app).post(`${API}/me/vehicles`).set(bearer(rahul)).send({ vehicleNumber: 'KA 05 7777' }).expect(201);

      // A shared car must never cost Aditi her booking — the mirror is best-effort by design.
      await request(app)
        .post(`${API}/bookings`)
        .set(bearer(aditi))
        .send({ bookingDate: DATE, vehicleType: 'CAR', vehicleNumber: 'KA 05 7777', carpoolPeople: 1 })
        .expect(201);

      // The registry row still belongs to Rahul; it was not silently reassigned.
      await expect(prisma.vehicle.findUniqueOrThrow({ where: { vehicleNumber: 'KA057777' } })).resolves.toMatchObject({
        ownerEmail: 'rahul@assent.example',
      });
      const aditiCars = await request(app).get(`${API}/me/vehicles`).set(bearer(aditi)).expect(200);
      expect(aditiCars.body.data.map((v: { vehicleNumber: string }) => v.vehicleNumber)).not.toContain('KA057777');
    });

    it('registers the shared car once for a multi-date batch', async () => {
      const user = await login('aditi@assent.example');
      const dates = [DATE];

      await request(app)
        .post(`${API}/bookings/batch`)
        .set(bearer(user))
        .send({ bookingDates: dates, vehicleType: 'CAR', vehicleNumber: 'KA 05 7777', carpoolPeople: 1 })
        .expect(200);

      const rows = await prisma.vehicle.findMany({ where: { vehicleNumber: 'KA057777' } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ ownerEmail: 'aditi@assent.example', isActive: true });
    });
  });

  it('does not let a user claim an active registry car with no linked account', async () => {
    const aditi = await login('aditi@assent.example');

    const duplicate = await request(app)
      .post(`${API}/me/vehicles`)
      .set(bearer(aditi))
      .send({ vehicleNumber: 'MH 12 XY 7788' });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.message).toMatch(/already registered/i);
    await expect(prisma.vehicle.findUniqueOrThrow({ where: { vehicleNumber: 'MH12XY7788' } })).resolves.toMatchObject({
      ownerEmail: null,
      userId: null,
    });
  });
});

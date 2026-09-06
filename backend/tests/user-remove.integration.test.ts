import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { API, bearer, futureBookableDate, login, resetTransactional } from './integration/helpers';

const TEST_EMAILS = [
  'remove-user',
  'remove-companyadmin',
  'remove-security1',
];

beforeEach(async () => {
  await resetTransactional();
  await prisma.commonPoolSlot.deleteMany({});
  const users = await prisma.user.findMany({ where: { email: { in: TEST_EMAILS } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.companyAdmin.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

async function createUser(email: string, roleName: 'USER' | 'COMPANY_ADMIN' | 'SECURITY', companyCode = 'ASSENT') {
  const [company, role] = await Promise.all([
    prisma.company.findFirstOrThrow({ where: { code: companyCode } }),
    prisma.role.findUniqueOrThrow({ where: { name: roleName } }),
  ]);
  const user = await prisma.user.create({
    data: {
      fullName: `Remove ${roleName}`,
      email,
      contactNumber: '+91-9000000999',
      address: 'Remove Test',
      pinCode: '411045',
      passwordHash: 'not-used',
      status: 'ACTIVE',
      emailVerified: true,
      companyId: company.id,
    },
  });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  if (roleName === 'COMPANY_ADMIN') {
    await prisma.companyAdmin.create({ data: { companyId: company.id, userId: user.id } });
  }
  return user;
}

describe('DELETE /users/:id', () => {
  it('lets company admins remove ordinary users from their own company', async () => {
    const target = await createUser('remove-user', 'USER');
    const ca = await login('companyadmin');

    await request(app).delete(`${API}/users/${target.id}`).set(bearer(ca)).expect(200);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.status).toBe('INACTIVE');
  });

  it('cancels live bookings and releases common-pool allocations for removed users', async () => {
    const target = await createUser('remove-user', 'USER');
    const ca = await login('companyadmin');
    const date = new Date(`${futureBookableDate()}T00:00:00.000Z`);
    const slot = await prisma.parkingSlot.findFirstOrThrow({
      where: { deletedAt: null },
      select: { id: true },
    });
    const booking = await prisma.bookingRequest.create({
      data: {
        bookingDate: date,
        userId: target.id,
        companyId: target.companyId,
        bookingType: 'COMMON_POOL',
        status: 'ALLOCATED',
        userAddress: target.address,
        pinCode: target.pinCode,
        vehicleNumber: 'KA051234',
        vehicleType: 'CAR',
        submittedAt: new Date(),
        allocationTime: new Date(),
      },
    });
    await prisma.commonPoolSlot.create({
      data: { bookingDate: date, slotId: slot.id, sourceCompanyId: target.companyId, status: 'ALLOCATED' },
    });
    await prisma.parkingAllocation.create({
      data: {
        bookingRequestId: booking.id,
        bookingDate: date,
        slotId: slot.id,
        companyId: target.companyId,
        allocationType: 'COMMON_POOL',
      },
    });

    await request(app).delete(`${API}/users/${target.id}`).set(bearer(ca)).expect(200);

    await expect(prisma.parkingAllocation.findUnique({ where: { bookingRequestId: booking.id } })).resolves.toBeNull();
    await expect(prisma.commonPoolSlot.findUniqueOrThrow({ where: { slotId_bookingDate: { slotId: slot.id, bookingDate: date } } })).resolves.toMatchObject({
      status: 'AVAILABLE',
    });
    await expect(prisma.bookingRequest.findUniqueOrThrow({ where: { id: booking.id } })).resolves.toMatchObject({
      status: 'CANCELLED',
      cancellationReason: 'User removed',
    });
    await expect(
      prisma.bookingRequest.count({
        where: { userId: target.id, status: { in: ['DRAFT', 'SUBMITTED', 'WAITLISTED', 'ALLOCATED'] } },
      }),
    ).resolves.toBe(0);
  });

  it('keeps company admins from removing privileged users', async () => {
    const target = await createUser('remove-companyadmin', 'COMPANY_ADMIN');
    const ca = await login('companyadmin');

    await request(app).delete(`${API}/users/${target.id}`).set(bearer(ca)).expect(403);
  });

  it('lets the super admin remove company-admin and security users', async () => {
    const admin = await createUser('remove-companyadmin', 'COMPANY_ADMIN');
    const guard = await createUser('remove-security1', 'SECURITY', 'REDBRICKS');
    const sa = await login('superadmin');

    await request(app).delete(`${API}/users/${admin.id}`).set(bearer(sa)).expect(200);
    await request(app).delete(`${API}/users/${guard.id}`).set(bearer(sa)).expect(200);

    await expect(prisma.companyAdmin.findFirst({ where: { userId: admin.id } })).resolves.toBeNull();
    await expect(prisma.user.findUniqueOrThrow({ where: { id: guard.id } })).resolves.toMatchObject({ status: 'INACTIVE' });
  });

  it('does not let the super admin remove ordinary users from the privileged screen action', async () => {
    const target = await createUser('remove-user', 'USER');
    const sa = await login('superadmin');

    await request(app).delete(`${API}/users/${target.id}`).set(bearer(sa)).expect(403);
  });
});

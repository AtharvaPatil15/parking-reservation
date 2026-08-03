import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { API, bearer, login } from './integration/helpers';

const TEST_EMAILS = [
  'remove-user@assent.example',
  'remove-admin@assent.example',
  'remove-security@redbricks.example',
];

beforeEach(async () => {
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
    const target = await createUser('remove-user@assent.example', 'USER');
    const ca = await login('admin@assent.example');

    await request(app).delete(`${API}/users/${target.id}`).set(bearer(ca)).expect(200);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.status).toBe('INACTIVE');
  });

  it('keeps company admins from removing privileged users', async () => {
    const target = await createUser('remove-admin@assent.example', 'COMPANY_ADMIN');
    const ca = await login('admin@assent.example');

    await request(app).delete(`${API}/users/${target.id}`).set(bearer(ca)).expect(403);
  });

  it('lets the super admin remove company-admin and security users', async () => {
    const admin = await createUser('remove-admin@assent.example', 'COMPANY_ADMIN');
    const guard = await createUser('remove-security@redbricks.example', 'SECURITY', 'REDBRICKS');
    const sa = await login('superadmin@redbricks.example');

    await request(app).delete(`${API}/users/${admin.id}`).set(bearer(sa)).expect(200);
    await request(app).delete(`${API}/users/${guard.id}`).set(bearer(sa)).expect(200);

    await expect(prisma.companyAdmin.findFirst({ where: { userId: admin.id } })).resolves.toBeNull();
    await expect(prisma.user.findUniqueOrThrow({ where: { id: guard.id } })).resolves.toMatchObject({ status: 'INACTIVE' });
  });

  it('does not let the super admin remove ordinary users from the privileged screen action', async () => {
    const target = await createUser('remove-user@assent.example', 'USER');
    const sa = await login('superadmin@redbricks.example');

    await request(app).delete(`${API}/users/${target.id}`).set(bearer(sa)).expect(403);
  });
});

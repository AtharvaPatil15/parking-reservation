/**
 * Wipe the local database back to "one super admin and an empty building".
 *
 * DESTRUCTIVE and dev-only. Requires `--yes`, and refuses to run against anything that does not look
 * like a local database, because the only thing worse than losing test data is losing somebody else's.
 *
 *   npm run db:wipe -- --yes
 *
 * What survives, and why each one has to:
 *
 *   Role                     — `User.roles` is how a login gets its permissions; no roles, no usable account.
 *   Company (Redbricks only) — `User.companyId` is NOT NULL, so the super admin must belong to a company.
 *   User (super admin only)  — the account you asked to keep.
 *   OfficeLocation           — there is NO endpoint to create one. `POST /parking-areas` looks up the
 *                              first office location and fails with "No office location is configured" if
 *                              there isn't one, so deleting it would permanently strand slot setup.
 *   SystemConfiguration      — allocation weights, run day/time, booking window. Config, not test data.
 *   WorkingDayConfiguration  — building-wide rows only (Mon–Fri). Company-scoped rows go with their company.
 *   Holiday                  — same: building-wide rows stay, company-scoped rows go.
 *   NotificationTemplate     — reference data.
 *
 * Everything else goes, including the parking areas and slots. Those ARE rebuildable through the UI
 * (Super Admin → Slots → add area, add slots), which is why they are safe to drop — but nothing can be
 * booked or allocated until you do, so the script says so on the way out.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const KEEP_USER_EMAIL = 'superadmin@redbricks.example';
const KEEP_COMPANY_CODE = 'REDBRICKS';
/** Same placeholder the main seed uses. Reset so you are guaranteed a way back in after the wipe. */
const DEV_PASSWORD = 'ChangeMe#12345';

async function main(): Promise<void> {
  if (!process.argv.includes('--yes')) {
    console.error('Refusing to wipe without --yes.\n\n  npm run db:wipe -- --yes\n');
    process.exitCode = 1;
    return;
  }
  // A wipe script that can reach production is a loaded gun. Local hosts only.
  const url = process.env.DATABASE_URL ?? '';
  if (!/@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(url)) {
    console.error(`Refusing to wipe: DATABASE_URL does not point at a local host.\n  ${url.replace(/:[^:@]*@/, ':***@')}\n`);
    process.exitCode = 1;
    return;
  }

  const keeper = await prisma.user.findFirst({ where: { email: KEEP_USER_EMAIL } });
  if (!keeper) {
    console.error(`Refusing to wipe: ${KEEP_USER_EMAIL} does not exist, so there would be no way back in.`);
    console.error('Run `npm run seed` first.');
    process.exitCode = 1;
    return;
  }
  const keepCompany = await prisma.company.findFirst({ where: { code: KEEP_COMPANY_CODE } });
  const keepCompanyId = keepCompany?.id ?? keeper.companyId;

  // Children before parents. Prisma will not reorder these for us, and a FK violation half way through
  // would leave the database in a state neither wiped nor intact.
  const steps: [string, () => Promise<{ count: number }>][] = [
    ['allocation score breakdowns', () => prisma.allocationScoreBreakdown.deleteMany()],
    ['parking allocations', () => prisma.parkingAllocation.deleteMany()],
    ['allocation runs', () => prisma.allocationRun.deleteMany()],
    ['carpool members', () => prisma.bookingCarpoolMember.deleteMany()],
    ['booking requests', () => prisma.bookingRequest.deleteMany()],
    ['common pool slots', () => prisma.commonPoolSlot.deleteMany()],
    ['gate events', () => prisma.gateEvent.deleteMany()],
    ['walk-in registrations', () => prisma.vehicleRegistrationRequest.deleteMany()],
    ['vehicles', () => prisma.vehicle.deleteMany()],
    ['slot blocks', () => prisma.slotBlock.deleteMany()],
    ['company quotas', () => prisma.companySlotAllocation.deleteMany()],
    ['parking slots', () => prisma.parkingSlot.deleteMany()],
    ['parking areas', () => prisma.parkingArea.deleteMany()],
    ['notifications', () => prisma.notification.deleteMany()],
    ['audit logs', () => prisma.auditLog.deleteMany()],
    // Every session, including the super admin's — a wipe should not leave a token minted against data
    // that no longer exists.
    ['refresh tokens', () => prisma.refreshToken.deleteMany()],
    ['company-admin assignments', () => prisma.companyAdmin.deleteMany()],
    // Company-scoped config follows its company out; building-wide rows (companyId null) stay.
    ['company holidays', () => prisma.holiday.deleteMany({ where: { companyId: { not: null } } })],
    ['company working days', () => prisma.workingDayConfiguration.deleteMany({ where: { companyId: { not: null } } })],
    ['role links (other users)', () => prisma.userRole.deleteMany({ where: { userId: { not: keeper.id } } })],
    ['users (other than the super admin)', () => prisma.user.deleteMany({ where: { id: { not: keeper.id } } })],
    ['companies (other than Redbricks)', () => prisma.company.deleteMany({ where: { id: { not: keepCompanyId } } })],
  ];

  for (const [label, run] of steps) {
    const { count } = await run();
    console.log(`  ${String(count).padStart(4)}  ${label}`);
  }

  // Put the keeper back in a known-good state: active, in the surviving company, with a password you know.
  // `npm run seed` upserts this user with `update: {}`, so it would NOT repair a forgotten password.
  await prisma.user.update({
    where: { id: keeper.id },
    data: {
      companyId: keepCompanyId,
      status: 'ACTIVE',
      emailVerified: true,
      deletedAt: null,
      passwordHash: await argon2.hash(DEV_PASSWORD),
    },
  });
  const superAdminRole = await prisma.role.findFirst({ where: { name: 'SUPER_ADMIN' } });
  if (superAdminRole) {
    const linked = await prisma.userRole.findFirst({ where: { userId: keeper.id, roleId: superAdminRole.id } });
    if (!linked) await prisma.userRole.create({ data: { userId: keeper.id, roleId: superAdminRole.id } });
  }

  console.log('\nWhat is left:');
  for (const [label, n] of [
    ['roles', await prisma.role.count()],
    ['companies', await prisma.company.count()],
    ['users', await prisma.user.count()],
    ['office locations', await prisma.officeLocation.count()],
    ['parking areas', await prisma.parkingArea.count()],
    ['parking slots', await prisma.parkingSlot.count()],
    ['system config rows', await prisma.systemConfiguration.count()],
    ['notification templates', await prisma.notificationTemplate.count()],
  ] as const) {
    console.log(`  ${String(n).padStart(4)}  ${label}`);
  }

  console.log(`\nLog in as  ${KEEP_USER_EMAIL}  /  ${DEV_PASSWORD}`);
  console.log('\nThe building has NO parking areas or slots. Nothing can be booked or allocated until you');
  console.log('add them: Super Admin → Slots → create a parking area, then add slots to it.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

/**
 * Parking POC — database seed (design artifact).
 *
 * Idempotent (upsert-based). Seeds the required baseline from the spec:
 *   Roles, Redbricks (building admin) + Super Admin, Assent company + Company Admin,
 *   sample users, office location + parking area + slots, Assent quota, system config,
 *   working-day config, a sample holiday, and notification templates.
 *
 * Runnable once the backend foundation + a Postgres instance exist (later phase):
 *   npx prisma migrate dev --name init
 *   npx prisma db seed
 *
 * Requires deps (added in the backend phase): @prisma/client, argon2.
 * Passwords here are placeholder DEV credentials — never use in production.
 */
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const DEV_PASSWORD = 'ChangeMe#12345';
const today = new Date('2026-07-28'); // deterministic effective date for the seed

async function main() {
  const passwordHash = await argon2.hash(DEV_PASSWORD);

  // 1. Roles ----------------------------------------------------------------
  const [superAdminRole, companyAdminRole, userRole] = await Promise.all([
    prisma.role.upsert({
      where: { name: 'SUPER_ADMIN' },
      update: {},
      create: { name: 'SUPER_ADMIN', description: 'Redbricks platform administrator' },
    }),
    prisma.role.upsert({
      where: { name: 'COMPANY_ADMIN' },
      update: {},
      create: { name: 'COMPANY_ADMIN', description: 'Administrator for a single company tenant' },
    }),
    prisma.role.upsert({
      where: { name: 'USER' },
      update: {},
      create: { name: 'USER', description: 'Company registered user' },
    }),
  ]);

  // 2. Companies ------------------------------------------------------------
  const redbricks = await prisma.company.upsert({
    where: { code: 'REDBRICKS' },
    update: {},
    create: { code: 'REDBRICKS', name: 'Redbricks (Building Administrator)', status: 'ACTIVE' },
  });
  const assent = await prisma.company.upsert({
    where: { code: 'ASSENT' },
    update: {},
    create: { code: 'ASSENT', name: 'Assent Compliance', status: 'ACTIVE' },
  });

  // 3. Super Admin (Redbricks) ---------------------------------------------
  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@redbricks.example' },
    update: {},
    create: {
      fullName: 'Redbricks Super Admin',
      email: 'superadmin@redbricks.example',
      contactNumber: '+91-9000000001',
      address: 'Redbricks HQ, Pune',
      pinCode: '411001',
      passwordHash,
      status: 'ACTIVE',
      emailVerified: true,
      companyId: redbricks.id,
    },
  });
  await linkRole(superAdmin.id, superAdminRole.id);

  // 4. Assent Company Admin -------------------------------------------------
  const assentAdmin = await prisma.user.upsert({
    where: { email: 'admin@assent.example' },
    update: {},
    create: {
      fullName: 'Assent Company Admin',
      email: 'admin@assent.example',
      contactNumber: '+91-9000000002',
      address: 'Assent Office, Baner, Pune',
      pinCode: '411045',
      passwordHash,
      status: 'ACTIVE',
      emailVerified: true,
      companyId: assent.id,
      distanceKm: 5.2,
    },
  });
  await linkRole(assentAdmin.id, companyAdminRole.id);
  await prisma.companyAdmin.upsert({
    where: { companyId_userId: { companyId: assent.id, userId: assentAdmin.id } },
    update: {},
    create: { companyId: assent.id, userId: assentAdmin.id, assignedById: superAdmin.id },
  });

  // 5. Sample Assent users (varied manually-entered distances — D6) ---------
  const sampleUsers = [
    { name: 'Aditi Rao', email: 'aditi@assent.example', pin: '411057', km: 12.4 },
    { name: 'Rahul Mehta', email: 'rahul@assent.example', pin: '411014', km: 24.8 },
    { name: 'Sara Khan', email: 'sara@assent.example', pin: '412115', km: 38.1 },
  ];
  for (const u of sampleUsers) {
    const created = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        fullName: u.name,
        email: u.email,
        contactNumber: '+91-9000000003',
        address: `${u.name} residence, Pune`,
        pinCode: u.pin,
        passwordHash,
        status: 'ACTIVE',
        emailVerified: true,
        companyId: assent.id,
        distanceKm: u.km,
      },
    });
    await linkRole(created.id, userRole.id);
  }

  // 6. Office location, parking area, slots (quota model) ------------------
  const office = await prisma.officeLocation.upsert({
    where: { id: 'seed-office-redbricks' },
    update: {},
    create: {
      id: 'seed-office-redbricks',
      name: 'Redbricks Tower, Baner',
      address: 'Baner Road, Pune, Maharashtra',
      timezone: 'Asia/Kolkata',
    },
  });
  const area = await prisma.parkingArea.upsert({
    where: { id: 'seed-area-b1' },
    update: {},
    create: { id: 'seed-area-b1', name: 'Basement 1', floor: 'B1', officeLocationId: office.id },
  });

  for (let i = 1; i <= 12; i++) {
    const slotNumber = `B1-${String(i).padStart(2, '0')}`;
    await prisma.parkingSlot.upsert({
      where: { parkingAreaId_slotNumber: { parkingAreaId: area.id, slotNumber } },
      update: {},
      create: {
        slotNumber,
        parkingAreaId: area.id,
        slotType: i <= 8 ? 'STANDARD' : i <= 10 ? 'EV_CHARGING' : 'ACCESSIBLE',
        status: 'AVAILABLE',
        hasEvCharging: i > 8 && i <= 10,
        isAccessible: i > 10,
      },
    });
  }

  // 7. Assent quota (effective today) --------------------------------------
  await prisma.companySlotAllocation.upsert({
    where: { id: 'seed-quota-assent' },
    update: { slotCount: 8, effectiveFrom: today },
    create: {
      id: 'seed-quota-assent',
      companyId: assent.id,
      slotCount: 8,
      effectiveFrom: today,
      createdById: superAdmin.id,
    },
  });

  // 8. System configuration -------------------------------------------------
  const config: Array<{ key: string; value: string; valueType: 'NUMBER' | 'TIME' | 'BOOLEAN' | 'STRING'; description: string }> = [
    { key: 'allocation.distanceWeight', value: '0.60', valueType: 'NUMBER', description: 'Weight of distance score' },
    { key: 'allocation.carpoolWeight', value: '0.40', valueType: 'NUMBER', description: 'Weight of carpool score' },
    { key: 'allocation.maxDistanceKm', value: '40', valueType: 'NUMBER', description: 'Distance cap for full distance score (D6/§3)' },
    { key: 'carpool.maxPeople', value: '4', valueType: 'NUMBER', description: 'Max people per car incl. driver (§3)' },
    { key: 'booking.primaryCutoff', value: '18:00', valueType: 'TIME', description: 'Primary window closes (IST, strictly before)' },
    { key: 'booking.primaryResultsBy', value: '20:00', valueType: 'TIME', description: 'Primary results published (IST)' },
    { key: 'booking.commonPoolClose', value: '22:00', valueType: 'TIME', description: 'Common-pool window closes (IST)' },
    { key: 'booking.commonPoolResultsBy', value: '23:00', valueType: 'TIME', description: 'Common-pool results published (IST)' },
    { key: 'booking.reminderBefore', value: '60', valueType: 'NUMBER', description: 'Minutes before cutoff to send the reminder' },
    { key: 'booking.windowWeeks', value: '2', valueType: 'NUMBER', description: 'How many weeks ahead the booking window is open (2 or 4)' },
    { key: 'booking.allocationRunFrequency', value: 'WEEKLY', valueType: 'STRING', description: 'Automatic allocation run interval (weekly, biweekly, or monthly)' },
    { key: 'booking.allocationRunDay', value: 'SUNDAY', valueType: 'STRING', description: 'Allocation run day' },
    { key: 'booking.allocationRunTime', value: '20:00', valueType: 'TIME', description: 'Allocation run time on the run day (IST)' },
    { key: 'booking.approvalLeadDays', value: '3', valueType: 'NUMBER', description: 'A date must be decided at least this many days before it (D11)' },
    { key: 'password.minLength', value: '10', valueType: 'NUMBER', description: 'Minimum password length' },
    // Notification config — delivery implemented later; see docs/notification-service-plan.md
    { key: 'notification.email.enabled', value: 'true', valueType: 'BOOLEAN', description: 'Master switch for email channel' },
    { key: 'notification.inApp.enabled', value: 'true', valueType: 'BOOLEAN', description: 'Master switch for in-app channel' },
    { key: 'notification.email.fromAddress', value: 'no-reply@redbricks.example', valueType: 'STRING', description: 'Default From address (provider chosen in a later phase)' },
  ];
  for (const c of config) {
    await prisma.systemConfiguration.upsert({
      where: { key: c.key },
      update: { value: c.value, valueType: c.valueType, description: c.description },
      create: { ...c, updatedById: superAdmin.id },
    });
  }

  // 9. Working-day configuration (global default: Mon–Fri working) ----------
  const days: Array<{ id: string; day: 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'; working: boolean }> = [
    { id: 'wd-mon', day: 'MONDAY', working: true },
    { id: 'wd-tue', day: 'TUESDAY', working: true },
    { id: 'wd-wed', day: 'WEDNESDAY', working: true },
    { id: 'wd-thu', day: 'THURSDAY', working: true },
    { id: 'wd-fri', day: 'FRIDAY', working: true },
    { id: 'wd-sat', day: 'SATURDAY', working: false },
    { id: 'wd-sun', day: 'SUNDAY', working: false },
  ];
  for (const d of days) {
    await prisma.workingDayConfiguration.upsert({
      where: { id: d.id },
      update: { isWorkingDay: d.working },
      create: { id: d.id, dayOfWeek: d.day, isWorkingDay: d.working, companyId: null },
    });
  }

  // 10. Sample holiday ------------------------------------------------------
  await prisma.holiday.upsert({
    where: { id: 'seed-holiday-independence' },
    update: {},
    create: {
      id: 'seed-holiday-independence',
      name: 'Independence Day',
      date: new Date('2026-08-15'),
      type: 'BUILDING',
      isParkingEnabled: false,
    },
  });

  // 11. Notification templates ---------------------------------------------
  const templates: Array<{ code: string; subject: string; body: string }> = [
    { code: 'REGISTRATION_RECEIVED', subject: 'Registration received', body: 'Hi {{fullName}}, we received your registration and it is pending approval.' },
    { code: 'REGISTRATION_APPROVED', subject: 'Registration approved', body: 'Hi {{fullName}}, your account is now active.' },
    { code: 'REGISTRATION_REJECTED', subject: 'Registration rejected', body: 'Hi {{fullName}}, your registration was not approved.' },
    { code: 'BOOKING_SUBMITTED', subject: 'Booking submitted', body: 'Your parking request for {{bookingDate}} was submitted.' },
    { code: 'BOOKING_CANCELLED', subject: 'Booking cancelled', body: 'Your parking request for {{bookingDate}} was cancelled.' },
    { code: 'PRIMARY_SLOT_ALLOCATED', subject: 'Slot allocated', body: 'You have been allocated slot {{slotNumber}} for {{bookingDate}}.' },
    { code: 'PRIMARY_SLOT_NOT_ALLOCATED', subject: 'Slot not allocated', body: 'No slot was allocated for {{bookingDate}}. You are on the waiting list.' },
    { code: 'COMMON_POOL_OPENED', subject: 'Common pool open', body: 'Common-pool booking is now open until 22:00.' },
    { code: 'COMMON_POOL_REQUEST_SUBMITTED', subject: 'Common-pool request submitted', body: 'Your common-pool request for {{bookingDate}} was submitted.' },
    { code: 'COMMON_POOL_SLOT_ALLOCATED', subject: 'Common-pool slot allocated', body: 'You have been allocated common-pool slot {{slotNumber}}.' },
    { code: 'COMMON_POOL_SLOT_NOT_ALLOCATED', subject: 'Common-pool slot not allocated', body: 'No common-pool slot was available for {{bookingDate}}.' },
    { code: 'SLOT_RELEASED', subject: 'Slot released', body: 'Slot {{slotNumber}} for {{bookingDate}} has been released.' },
    { code: 'BOOKING_REMINDER', subject: 'Booking reminder', body: 'Reminder: submit your parking request before {{cutoff}} today.' },
  ];
  for (const t of templates) {
    await prisma.notificationTemplate.upsert({
      where: { code: t.code },
      update: { subject: t.subject, body: t.body },
      create: { code: t.code, channel: 'EMAIL', subject: t.subject, body: t.body, isActive: true },
    });
  }

  console.log('Seed complete: roles, Redbricks + Super Admin, Assent + Company Admin, sample users, slots, quota, config, templates.');
}

async function linkRole(userId: string, roleId: string) {
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId } },
    update: {},
    create: { userId, roleId },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

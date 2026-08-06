/**
 * Bootstrap a REAL deployment: the minimum data the app cannot function without, and nothing else.
 *
 *   npm run seed:essentials
 *
 * This is `seed.ts` without the demo cast. `seed.ts` is for local development — it creates Assent, TTC,
 * Aditi/Rahul/Sara, their cars and a quota, all with the publicly-known password `ChangeMe#12345`. None
 * of that belongs in a deployed environment.
 *
 * What this creates, and why each one is mandatory rather than nice-to-have:
 *
 *   Roles                    `User.roles` is how a login gets its permissions. No roles → no usable account.
 *   Operator company         `User.companyId` is NOT NULL, so the super admin must belong to something.
 *   Super admin              The only way in. Everything else is created through the UI by this account.
 *   Office location          There is NO endpoint to create one. `POST /parking-areas` looks up the first
 *                            office location and fails with "No office location is configured" without it,
 *                            so a deployment that skips this can never have parking areas at all.
 *   Parking area + slots     Physical bays. Allocation assigns these; quota only says how many a company
 *                            may win. With a quota but no slots, `runPrimaryAllocation` throws
 *                            "Not enough usable parking slots".
 *   System configuration     Allocation weights, the run schedule, the booking window. Read from the DB
 *                            (D8), not env — absent, allocation has no weights and no run time.
 *   Working days             Mon–Fri (D7). Absent, the booking window has no working days to offer.
 *   Notification templates   Looked up by code when a notification is raised.
 *
 * What it deliberately does NOT create: tenant companies, ordinary users, vehicles, quotas, bookings, or
 * holidays. Those are the building operator's job, through the UI, with real data.
 *
 * Idempotent — safe to re-run. It reuses the same row ids as `seed.ts` for the office, parking area and
 * working days, so running both converges on one building instead of creating two.
 *
 * Configure via environment variables (all optional except the password):
 *
 *   SUPERADMIN_EMAIL         default superadmin@redbricks.example
 *   SUPERADMIN_PASSWORD      REQUIRED. Min 10 chars. Refuses the seed's public dev password.
 *   SUPERADMIN_NAME          default "Super Admin"
 *   SUPERADMIN_CONTACT       default +91-9000000001
 *   OPERATOR_COMPANY_NAME    default "Redbricks (Building Administrator)"
 *   OPERATOR_COMPANY_CODE    default REDBRICKS
 *   BUILDING_NAME            default "Redbricks Tower, Baner"
 *   BUILDING_ADDRESS         default "Baner Road, Pune, Maharashtra"
 *   BUILDING_TIMEZONE        default Asia/Kolkata
 *   PARKING_AREA_NAME        default "Basement 1"
 *   PARKING_AREA_FLOOR       default B1
 *   SLOT_COUNT               default 20
 *   SLOT_PREFIX              default "<floor>-"   e.g. B1-01 … B1-20
 *   SLOT_EV_COUNT            default 2   (bays with EV charging)
 *   SLOT_ACCESSIBLE_COUNT    default 2   (accessible bays)
 *
 * Pass `--reset-password` to overwrite an existing super admin's password. Without it, an existing
 * account is left alone — so a routine re-run cannot clobber a password that was rotated after handover.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

/** The public placeholder from `seed.ts`. Anything matching it is not a password. */
const KNOWN_DEV_PASSWORD = 'ChangeMe#12345';

const env = (key: string, fallback: string): string => process.env[key]?.trim() || fallback;
const envInt = (key: string, fallback: number): number => {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${key} must be a non-negative integer, got "${raw}"`);
  return n;
};

const CONFIG: Array<{ key: string; value: string; valueType: Prisma.SystemConfigurationCreateInput['valueType']; description: string }> = [
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
  { key: 'booking.allocationRunDay', value: 'SUNDAY', valueType: 'STRING', description: 'Automatic allocation run day' },
  { key: 'booking.allocationRunTime', value: '20:00', valueType: 'TIME', description: 'Automatic allocation run time on the run day (IST)' },
  { key: 'booking.commonPoolRunTime', value: '20:00', valueType: 'TIME', description: 'Automatic common-pool run time on the run day (IST)' },
  { key: 'booking.approvalLeadDays', value: '1', valueType: 'NUMBER', description: 'A date must be decided at least this many days before it (D11/D21)' },
  { key: 'password.minLength', value: '10', valueType: 'NUMBER', description: 'Minimum password length' },
  { key: 'notification.email.enabled', value: 'true', valueType: 'BOOLEAN', description: 'Master switch for email channel' },
  { key: 'notification.inApp.enabled', value: 'true', valueType: 'BOOLEAN', description: 'Master switch for in-app channel' },
  { key: 'notification.email.fromAddress', value: 'no-reply@redbricks.example', valueType: 'STRING', description: 'Default From address (provider chosen in a later phase)' },
];

/** Mon–Fri working (D7). Ids match `seed.ts` so the two scripts do not create duplicate rows. */
const WORKING_DAYS: Array<{ id: string; day: Prisma.WorkingDayConfigurationCreateInput['dayOfWeek']; working: boolean }> = [
  { id: 'wd-mon', day: 'MONDAY', working: true },
  { id: 'wd-tue', day: 'TUESDAY', working: true },
  { id: 'wd-wed', day: 'WEDNESDAY', working: true },
  { id: 'wd-thu', day: 'THURSDAY', working: true },
  { id: 'wd-fri', day: 'FRIDAY', working: true },
  { id: 'wd-sat', day: 'SATURDAY', working: false },
  { id: 'wd-sun', day: 'SUNDAY', working: false },
];

const TEMPLATES: Array<{ code: string; subject: string; body: string }> = [
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

async function main(): Promise<void> {
  const email = env('SUPERADMIN_EMAIL', 'superadmin@redbricks.example').toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD?.trim() ?? '';
  const resetPassword = process.argv.includes('--reset-password');

  // Refuse before touching anything — a half-bootstrapped database is worse than an empty one.
  if (!password) {
    console.error('SUPERADMIN_PASSWORD is required.\n');
    console.error('  PowerShell:  $env:SUPERADMIN_PASSWORD="..."; npm run seed:essentials');
    console.error('  bash:        SUPERADMIN_PASSWORD="..." npm run seed:essentials\n');
    process.exitCode = 1;
    return;
  }
  if (password === KNOWN_DEV_PASSWORD) {
    console.error(`Refusing: that is the public dev password from seed.ts. Choose a real one.`);
    process.exitCode = 1;
    return;
  }
  // Matches the `password.minLength` config row this script seeds, so the bootstrap account cannot be
  // weaker than the rule every other account is held to.
  if (password.length < 10) {
    console.error('Refusing: SUPERADMIN_PASSWORD must be at least 10 characters (password.minLength).');
    process.exitCode = 1;
    return;
  }

  const slotCount = envInt('SLOT_COUNT', 20);
  const evCount = envInt('SLOT_EV_COUNT', 2);
  const accessibleCount = envInt('SLOT_ACCESSIBLE_COUNT', 2);
  if (evCount + accessibleCount > slotCount) {
    console.error(`Refusing: SLOT_EV_COUNT + SLOT_ACCESSIBLE_COUNT (${evCount + accessibleCount}) exceeds SLOT_COUNT (${slotCount}).`);
    process.exitCode = 1;
    return;
  }

  console.log(`Bootstrapping ${new URL(process.env.DATABASE_URL ?? 'postgresql://unknown').host}\n`);

  // --- 1. Roles -------------------------------------------------------------
  const roleDefs = [
    { name: 'SUPER_ADMIN', description: 'Redbricks platform administrator' },
    { name: 'COMPANY_ADMIN', description: 'Administrator for a single company tenant' },
    { name: 'USER', description: 'Company registered user' },
    { name: 'SECURITY', description: 'Building security / gate operator' },
  ];
  for (const r of roleDefs) {
    await prisma.role.upsert({ where: { name: r.name }, update: {}, create: r });
  }
  const superAdminRole = await prisma.role.findFirstOrThrow({ where: { name: 'SUPER_ADMIN' } });
  console.log(`  roles                  ${roleDefs.length}`);

  // --- 2. Operator company (the super admin has to belong somewhere) --------
  const operator = await prisma.company.upsert({
    where: { code: env('OPERATOR_COMPANY_CODE', 'REDBRICKS') },
    update: {},
    create: {
      code: env('OPERATOR_COMPANY_CODE', 'REDBRICKS'),
      name: env('OPERATOR_COMPANY_NAME', 'Redbricks (Building Administrator)'),
      status: 'ACTIVE',
    },
  });
  console.log(`  operator company       ${operator.name}`);

  // --- 3. Super admin -------------------------------------------------------
  const passwordHash = await argon2.hash(password);
  /**
   * `findFirst` + create/update, NOT `upsert({ where: { email } })`.
   *
   * `partial-unique.sql` drops `User_email_key` and replaces it with `User_email_active_key`, which is
   * PARTIAL (`WHERE "deletedAt" IS NULL`). Postgres will not accept a partial index as an `ON CONFLICT`
   * arbiter unless the statement repeats its predicate, and Prisma does not emit one — so an upsert on
   * email fails outright with 42P10 ("no unique or exclusion constraint matching the ON CONFLICT
   * specification") on any database where that SQL has been applied. This script has to work whether it
   * runs before or after it.
   *
   * Scoped to `deletedAt: null` deliberately: a soft-deleted row with the same address does not block a
   * new one, which is the whole reason the index is partial.
   */
  const existing = await prisma.user.findFirst({ where: { email, deletedAt: null } });
  const passwordAction = !existing
    ? 'created'
    : resetPassword
      ? 'password reset'
      : 'left alone (pass --reset-password to change it)';
  const superAdmin = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        // Never silently rewrite a live password: after an ownership handover it will have been rotated,
        // and a routine re-run of this script must not undo that.
        data: {
          status: 'ACTIVE',
          emailVerified: true,
          companyId: operator.id,
          ...(resetPassword ? { passwordHash } : {}),
        },
      })
    : await prisma.user.create({
        data: {
          fullName: env('SUPERADMIN_NAME', 'Super Admin'),
          email,
          contactNumber: env('SUPERADMIN_CONTACT', '+91-9000000001'),
          address: env('BUILDING_ADDRESS', 'Baner Road, Pune, Maharashtra'),
          pinCode: env('BUILDING_PIN', '411045'),
          passwordHash,
          status: 'ACTIVE',
          emailVerified: true,
          companyId: operator.id,
        },
      });
  const linked = await prisma.userRole.findFirst({ where: { userId: superAdmin.id, roleId: superAdminRole.id } });
  if (!linked) await prisma.userRole.create({ data: { userId: superAdmin.id, roleId: superAdminRole.id } });
  console.log(`  super admin            ${email} — ${passwordAction}`);

  // --- 4. Office location ---------------------------------------------------
  // Same id as seed.ts: no endpoint creates these, so converging on one row matters more than a tidy id.
  const office = await prisma.officeLocation.upsert({
    where: { id: 'seed-office-redbricks' },
    update: {},
    create: {
      id: 'seed-office-redbricks',
      name: env('BUILDING_NAME', 'Redbricks Tower, Baner'),
      address: env('BUILDING_ADDRESS', 'Baner Road, Pune, Maharashtra'),
      timezone: env('BUILDING_TIMEZONE', 'Asia/Kolkata'),
    },
  });
  console.log(`  office location        ${office.name}`);

  // --- 5. Parking area + slots ---------------------------------------------
  const floor = env('PARKING_AREA_FLOOR', 'B1');
  const area = await prisma.parkingArea.upsert({
    where: { id: 'seed-area-b1' },
    update: {},
    create: {
      id: 'seed-area-b1',
      name: env('PARKING_AREA_NAME', 'Basement 1'),
      floor,
      officeLocationId: office.id,
    },
  });
  const prefix = env('SLOT_PREFIX', `${floor}-`);
  const pad = String(slotCount).length < 2 ? 2 : String(slotCount).length;
  // Accessible bays last, EV immediately before — so the numbering of ordinary bays never shifts when
  // the counts change.
  const firstAccessible = slotCount - accessibleCount + 1;
  const firstEv = firstAccessible - evCount;
  for (let i = 1; i <= slotCount; i++) {
    const slotNumber = `${prefix}${String(i).padStart(pad, '0')}`;
    const isAccessible = i >= firstAccessible;
    const hasEv = !isAccessible && i >= firstEv;
    await prisma.parkingSlot.upsert({
      where: { parkingAreaId_slotNumber: { parkingAreaId: area.id, slotNumber } },
      update: {},
      create: {
        slotNumber,
        parkingAreaId: area.id,
        slotType: isAccessible ? 'ACCESSIBLE' : hasEv ? 'EV_CHARGING' : 'STANDARD',
        status: 'AVAILABLE',
        hasEvCharging: hasEv,
        isAccessible,
      },
    });
  }
  console.log(`  parking slots          ${slotCount} in ${area.name} (${prefix}01…${prefix}${String(slotCount).padStart(pad, '0')}) — ${evCount} EV, ${accessibleCount} accessible`);

  // --- 6. System configuration ---------------------------------------------
  for (const c of CONFIG) {
    await prisma.systemConfiguration.upsert({
      where: { key: c.key },
      // Values are editable at /admin/config, so a re-run must not revert an operator's changes.
      update: { description: c.description },
      create: { ...c, updatedById: superAdmin.id },
    });
  }
  console.log(`  system config          ${CONFIG.length} keys`);

  // --- 7. Working days + templates -----------------------------------------
  for (const d of WORKING_DAYS) {
    await prisma.workingDayConfiguration.upsert({
      where: { id: d.id },
      update: {},
      create: { id: d.id, dayOfWeek: d.day, isWorkingDay: d.working, companyId: null },
    });
  }
  console.log(`  working days           Mon–Fri`);

  for (const t of TEMPLATES) {
    await prisma.notificationTemplate.upsert({
      where: { code: t.code },
      update: { subject: t.subject, body: t.body },
      create: { code: t.code, channel: 'EMAIL', subject: t.subject, body: t.body, isActive: true },
    });
  }
  console.log(`  notification templates ${TEMPLATES.length}`);

  // --- 8. Verify partial-unique.sql actually ran ----------------------------
  // Prisma's DSL cannot express partial unique indexes, so they live in raw SQL outside the migration
  // chain. This is the only place in a deployment flow that naturally sits *after* migrating, so it is
  // the right place to notice they are missing — the symptoms otherwise appear weeks later.
  const expected = ['User_email_active_key', 'GateEvent_open_visit_key', 'VehicleRegistrationRequest_pending_key'];
  const found = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes WHERE indexname = ANY($1::text[])`,
    expected,
  );
  const missing = expected.filter((i) => !found.some((f) => f.indexname === i));
  if (missing.length) {
    console.log(`\n  !! MISSING PARTIAL INDEXES: ${missing.join(', ')}`);
    console.log('     partial-unique.sql has not been applied. Run:');
    console.log('       npx prisma db execute --file prisma/partial-unique.sql --schema prisma/schema.prisma');
    console.log('     Without them a soft-deleted email blocks re-registration forever, and the gate');
    console.log('     loses its double-check-in and duplicate-walk-in backstops.');
  } else {
    console.log(`  partial indexes        all ${expected.length} present`);
  }

  console.log('\nNot created — do these in the UI as the super admin:');
  console.log('  1. Companies                (Super Admin → Companies)');
  console.log('  2. A quota per company      effective TODAY or earlier, or it reads as zero');
  console.log('  3. Company admins / users   they register, you approve');
  console.log('\nSign in:');
  console.log(`  ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

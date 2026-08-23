-- =============================================================================
-- Reset the Parking POC database to a bare state: ONE Super Admin login, nothing else.
--
-- KEEPS (the app cannot log in or boot without these):
--   User                     — only the Super Admin row
--   Company                  — only the SA's own company (User.companyId is NOT NULL)
--   UserRole                 — only the SA -> SUPER_ADMIN grant
--   Role                     — all 3 rows; needed to create any user later
--   SystemConfiguration      — cutoffs / weights / caps read at runtime
--   OfficeLocation, ParkingArea, NotificationTemplate — inert scaffolding, see script B
--
-- DELETES: every user, company, admin grant, slot, quota, block, booking, carpool
--          member, allocation, run, score breakdown, common-pool row, notification,
--          audit row, refresh token, vehicle, gate event and walk-in registration.
--
-- Idempotent: safe to run repeatedly. Transactional: all-or-nothing.
--
-- Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/reset-keep-superadmin.sql
-- Docker:
--   docker exec -i <pg-container> psql -U postgres -d parking_poc -v ON_ERROR_STOP=1 \
--     < prisma/sql/reset-keep-superadmin.sql
-- =============================================================================

BEGIN;

-- --- 0. Pin the survivor -----------------------------------------------------
-- Change this email if your Super Admin differs.
CREATE TEMP TABLE _keep ON COMMIT DROP AS
SELECT u.id AS user_id, u."companyId" AS company_id
FROM "User" u
WHERE u.email = 'superadmin@redbricks.example';

-- Abort rather than empty the database when the SA doesn't exist (typo, wrong DB).
DO $$
BEGIN
  IF (SELECT count(*) FROM _keep) <> 1 THEN
    RAISE EXCEPTION
      'Refusing to wipe: expected exactly 1 Super Admin, found %. Check the email in step 0.',
      (SELECT count(*) FROM _keep);
  END IF;
END $$;

-- --- 1. Transactional + inventory data --------------------------------------
-- One statement so mutual FKs never block the order. CASCADE covers dependents.
--
-- `VehicleRegistrationRequest` has to be named explicitly. TRUNCATE ... CASCADE only follows real
-- foreign keys, and its link to `Vehicle` is `vehicleId` — a plain nullable column with no @relation,
-- so truncating Vehicle does NOT reach it. Its `companyId`, however, IS a required FK defaulting to
-- RESTRICT, so a single leftover walk-in request made step 4 below fail with
--   "update or delete on table Company violates RESTRICT setting of foreign key constraint
--    VehicleRegistrationRequest_companyId_fkey"
-- and roll the whole reset back. Harmless (the transaction protects the data) but the script could not
-- complete on any database where a guard had ever registered a walk-in car. Fixed 2026-08-23.
TRUNCATE TABLE
  "BookingCarpoolMember",
  "AllocationScoreBreakdown",
  "ParkingAllocation",
  "CommonPoolSlot",
  "AllocationRun",
  "BookingRequest",
  "SlotBlock",
  "CompanySlotAllocation",
  "ParkingSlot",
  "CompanyAdmin",
  "Notification",
  "AuditLog",
  "RefreshToken",
  "GateEvent",
  "VehicleRegistrationRequest",
  "Vehicle"
CASCADE;

-- --- 2. Calendar rows scoped to tenants that are about to disappear ----------
-- Holiday / WorkingDayConfiguration have a nullable companyId. Global rows
-- (companyId IS NULL) survive; per-tenant rows would dangle, so drop them.
DELETE FROM "Holiday"
WHERE "companyId" IS NOT NULL
  AND "companyId" <> (SELECT company_id FROM _keep);

DELETE FROM "WorkingDayConfiguration"
WHERE "companyId" IS NOT NULL
  AND "companyId" <> (SELECT company_id FROM _keep);

-- --- 3. Users ----------------------------------------------------------------
-- UserRole and RefreshToken are ON DELETE CASCADE, but delete the grants first
-- so this reads correctly even if those constraints change.
DELETE FROM "UserRole"
WHERE "userId" <> (SELECT user_id FROM _keep);

DELETE FROM "User"
WHERE id <> (SELECT user_id FROM _keep);

-- --- 4. Companies ------------------------------------------------------------
DELETE FROM "Company"
WHERE id <> (SELECT company_id FROM _keep);

COMMIT;

-- --- 5. Verify ---------------------------------------------------------------
SELECT 'User'                    AS table_name, count(*) AS rows FROM "User"
UNION ALL SELECT 'Company',                     count(*) FROM "Company"
UNION ALL SELECT 'UserRole',                    count(*) FROM "UserRole"
UNION ALL SELECT 'Role (kept)',                 count(*) FROM "Role"
UNION ALL SELECT 'SystemConfiguration (kept)',  count(*) FROM "SystemConfiguration"
UNION ALL SELECT 'CompanyAdmin',                count(*) FROM "CompanyAdmin"
UNION ALL SELECT 'ParkingSlot',                 count(*) FROM "ParkingSlot"
UNION ALL SELECT 'CompanySlotAllocation',       count(*) FROM "CompanySlotAllocation"
UNION ALL SELECT 'SlotBlock',                   count(*) FROM "SlotBlock"
UNION ALL SELECT 'BookingRequest',              count(*) FROM "BookingRequest"
UNION ALL SELECT 'ParkingAllocation',           count(*) FROM "ParkingAllocation"
UNION ALL SELECT 'AllocationRun',               count(*) FROM "AllocationRun"
UNION ALL SELECT 'Notification',                count(*) FROM "Notification"
UNION ALL SELECT 'AuditLog',                    count(*) FROM "AuditLog"
UNION ALL SELECT 'RefreshToken',                count(*) FROM "RefreshToken"
UNION ALL SELECT 'GateEvent',                   count(*) FROM "GateEvent"
UNION ALL SELECT 'Vehicle',                     count(*) FROM "Vehicle"
ORDER BY table_name;

-- Confirm the surviving login.
SELECT u.email, u.status, c.name AS company, r.name AS role
FROM "User" u
JOIN "Company"  c ON c.id = u."companyId"
JOIN "UserRole" ur ON ur."userId" = u.id
JOIN "Role"     r ON r.id = ur."roleId";

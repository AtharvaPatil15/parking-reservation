-- =============================================================================
-- OPTIONAL add-on — run AFTER reset-keep-superadmin.sql.
--
-- Strips the remaining non-login scaffolding for a truly bare database:
--   ParkingArea, NotificationTemplate, Holiday, WorkingDayConfiguration
--
-- Deliberately KEEPS exactly one OfficeLocation (and creates one if the table is
-- empty). There is no API to create an office location — `POST /parking-areas`
-- calls officeLocation.findFirst() and returns
--   400 VALIDATION_ERROR "No office location is configured"
-- when none exists (slots.service.ts createParkingArea). Truncating the table
-- therefore bricks slot setup with no in-app way to recover.
--
-- WARNING — read before running:
--   * Removing every ParkingArea leaves the "Add slot" area picker empty until
--     the SA adds an area — but that IS reachable from the UI, so it's a safe wipe.
--   * Dropping NotificationTemplate rows disables templated notifications.
--   * This does NOT touch Role or SystemConfiguration. Deleting those breaks
--     login and the booking-window logic respectively — restore them with
--     `npm run db:seed` if you ever clear them by accident.
--
-- Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/reset-strip-scaffolding.sql
-- =============================================================================

BEGIN;

TRUNCATE TABLE
  "ParkingArea",
  "NotificationTemplate",
  "Holiday",
  "WorkingDayConfiguration"
CASCADE;

-- Collapse to a single office location: drop all but the oldest...
DELETE FROM "OfficeLocation"
WHERE id <> (SELECT id FROM "OfficeLocation" ORDER BY "createdAt" ASC LIMIT 1);

-- ...and bootstrap one if the table was already empty, so POST /parking-areas
-- can never hit "No office location is configured".
INSERT INTO "OfficeLocation" (id, name, address, timezone, "createdAt", "updatedAt")
SELECT 'seed-office-1', 'Redbricks Tower, Baner', 'Baner, Pune, Maharashtra',
       'Asia/Kolkata', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "OfficeLocation");

COMMIT;

SELECT 'OfficeLocation'          AS table_name, count(*) AS rows FROM "OfficeLocation"
UNION ALL SELECT 'ParkingArea',                 count(*) FROM "ParkingArea"
UNION ALL SELECT 'NotificationTemplate',        count(*) FROM "NotificationTemplate"
UNION ALL SELECT 'Holiday',                     count(*) FROM "Holiday"
UNION ALL SELECT 'WorkingDayConfiguration',     count(*) FROM "WorkingDayConfiguration"
UNION ALL SELECT 'Role (still kept)',           count(*) FROM "Role"
UNION ALL SELECT 'SystemConfiguration (kept)',  count(*) FROM "SystemConfiguration"
ORDER BY table_name;

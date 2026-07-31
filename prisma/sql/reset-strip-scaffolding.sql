-- =============================================================================
-- OPTIONAL add-on — run AFTER reset-keep-superadmin.sql.
--
-- Strips the remaining non-login scaffolding for a truly bare database:
--   OfficeLocation, ParkingArea, NotificationTemplate,
--   Holiday, WorkingDayConfiguration
--
-- WARNING — read before running:
--   * Removing every OfficeLocation/ParkingArea leaves the Super Admin with no
--     area to attach slots to, so "Add slot" has an empty area picker until you
--     create one through the UI or API.
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
  "OfficeLocation",
  "NotificationTemplate",
  "Holiday",
  "WorkingDayConfiguration"
CASCADE;

COMMIT;

SELECT 'OfficeLocation'          AS table_name, count(*) AS rows FROM "OfficeLocation"
UNION ALL SELECT 'ParkingArea',                 count(*) FROM "ParkingArea"
UNION ALL SELECT 'NotificationTemplate',        count(*) FROM "NotificationTemplate"
UNION ALL SELECT 'Holiday',                     count(*) FROM "Holiday"
UNION ALL SELECT 'WorkingDayConfiguration',     count(*) FROM "WorkingDayConfiguration"
UNION ALL SELECT 'Role (still kept)',           count(*) FROM "Role"
UNION ALL SELECT 'SystemConfiguration (kept)',  count(*) FROM "SystemConfiguration"
ORDER BY table_name;

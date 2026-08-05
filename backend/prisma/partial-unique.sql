-- F7: soft-delete-aware uniqueness.
-- Prisma's migration creates a full unique index on User.email ("User_email_key"). Swap it for a
-- PARTIAL unique index so a soft-deleted (deletedAt IS NOT NULL) row does not block re-registration
-- of the same email. Run AFTER `prisma migrate` (or after db/create-schema.js).
DROP INDEX IF EXISTS "User_email_key";
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_active_key"
  ON "User" ("email")
  WHERE "deletedAt" IS NULL;

-- Phase 7: one OPEN gate visit per car per day. A vehicle may be checked in and out repeatedly
-- (many CHECKED_OUT rows for the same date), but never checked in twice without checking out.
-- The service pre-checks for a clean 409; this index is the concurrency backstop.
CREATE UNIQUE INDEX IF NOT EXISTS "GateEvent_open_visit_key"
  ON "GateEvent" ("vehicleNumber", "bookingDate")
  WHERE "status" = 'CHECKED_IN';

-- One OPEN walk-in registration request per car. A plate may accumulate any number of REJECTED
-- requests (turned away once, registered properly later), but two people must not be able to queue the
-- same plate for two different companies. The service pre-checks for a clean 409; this is the backstop.
CREATE UNIQUE INDEX IF NOT EXISTS "VehicleRegistrationRequest_pending_key"
  ON "VehicleRegistrationRequest" ("vehicleNumber")
  WHERE "status" = 'PENDING';

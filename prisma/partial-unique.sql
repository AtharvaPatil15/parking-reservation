-- F7: soft-delete-aware uniqueness.
-- Prisma's migration creates a full unique index on User.email ("User_email_key"). Swap it for a
-- PARTIAL unique index so a soft-deleted (deletedAt IS NOT NULL) row does not block re-registration
-- of the same email. Run AFTER `prisma migrate` (or after db/create-schema.js).
DROP INDEX IF EXISTS "User_email_key";
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_active_key"
  ON "User" ("email")
  WHERE "deletedAt" IS NULL;

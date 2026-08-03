-- Phase 7 — vehicle registry + gate check-in/check-out (security persona).
-- See docs/phase-7-no-rejection-booking-and-security.md §5.
--
-- NOTE: `prisma migrate diff` also wants to re-create "User_email_key" as a FULL unique index. That is
-- deliberately omitted — F7 replaced it with the PARTIAL index "User_email_active_key"
-- (prisma/partial-unique.sql) so a soft-deleted user does not block re-registration of their email.

-- CreateEnum
CREATE TYPE "GateEventStatus" AS ENUM ('CHECKED_IN', 'CHECKED_OUT');

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "vehicleNumber" TEXT NOT NULL,
    "displayNumber" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "ownerEmail" TEXT,
    "contactNumber" TEXT,
    "companyId" TEXT,
    "userId" TEXT,
    "vehicleType" "VehicleType" NOT NULL DEFAULT 'CAR',
    "makeModel" TEXT,
    "colour" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GateEvent" (
    "id" TEXT NOT NULL,
    "vehicleNumber" TEXT NOT NULL,
    "vehicleId" TEXT,
    "userId" TEXT,
    "companyId" TEXT,
    "bookingRequestId" TEXT,
    "bookingDate" DATE NOT NULL,
    "hadBooking" BOOLEAN NOT NULL DEFAULT false,
    "status" "GateEventStatus" NOT NULL DEFAULT 'CHECKED_IN',
    "ownerNameSnapshot" TEXT,
    "checkInAt" TIMESTAMP(3) NOT NULL,
    "checkOutAt" TIMESTAMP(3),
    "checkedInById" TEXT NOT NULL,
    "checkedOutById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_vehicleNumber_key" ON "Vehicle"("vehicleNumber");

-- CreateIndex
CREATE INDEX "Vehicle_companyId_idx" ON "Vehicle"("companyId");

-- CreateIndex
CREATE INDEX "Vehicle_ownerEmail_idx" ON "Vehicle"("ownerEmail");

-- CreateIndex
CREATE INDEX "Vehicle_userId_idx" ON "Vehicle"("userId");

-- CreateIndex
CREATE INDEX "GateEvent_bookingDate_status_idx" ON "GateEvent"("bookingDate", "status");

-- CreateIndex
CREATE INDEX "GateEvent_vehicleNumber_bookingDate_idx" ON "GateEvent"("vehicleNumber", "bookingDate");

-- CreateIndex
CREATE INDEX "GateEvent_companyId_bookingDate_hadBooking_idx" ON "GateEvent"("companyId", "bookingDate", "hadBooking");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateEvent" ADD CONSTRAINT "GateEvent_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateEvent" ADD CONSTRAINT "GateEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique index (Prisma DSL cannot express it): a car may have many completed visits on a
-- date but only ONE open one. Race backstop behind the service-level 409.
CREATE UNIQUE INDEX "GateEvent_open_visit_key"
  ON "GateEvent" ("vehicleNumber", "bookingDate")
  WHERE "status" = 'CHECKED_IN';

-- CreateEnum
CREATE TYPE "VehicleRegistrationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "VehicleRegistrationRequest" (
    "id" TEXT NOT NULL,
    "vehicleNumber" TEXT NOT NULL,
    "displayNumber" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "ownerEmail" TEXT,
    "contactNumber" TEXT,
    "companyId" TEXT NOT NULL,
    "vehicleType" "VehicleType" NOT NULL DEFAULT 'CAR',
    "makeModel" TEXT,
    "colour" TEXT,
    "notes" TEXT,
    "status" "VehicleRegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "vehicleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleRegistrationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleRegistrationRequest_companyId_status_idx" ON "VehicleRegistrationRequest"("companyId", "status");

-- CreateIndex
CREATE INDEX "VehicleRegistrationRequest_status_idx" ON "VehicleRegistrationRequest"("status");

-- CreateIndex
CREATE INDEX "VehicleRegistrationRequest_vehicleNumber_idx" ON "VehicleRegistrationRequest"("vehicleNumber");

-- AddForeignKey
ALTER TABLE "VehicleRegistrationRequest" ADD CONSTRAINT "VehicleRegistrationRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


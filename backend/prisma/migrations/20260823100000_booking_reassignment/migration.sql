-- Last-minute handover (2026-08-23): a company admin can move an allocated booking to a colleague
-- when the original booker drops out on the day. The booking row changes owner, so the previous owner
-- is snapshotted here — after the swap nothing else in the system remembers who won the slot.
--
-- Soft refs (no FK), matching ParkingAllocation.overrideById and SystemConfiguration.updatedById: a
-- deleted user must not block or cascade into a booking's history.
ALTER TABLE "BookingRequest" ADD COLUMN "reassignedFromUserId" TEXT;
ALTER TABLE "BookingRequest" ADD COLUMN "reassignedFromName" TEXT;
ALTER TABLE "BookingRequest" ADD COLUMN "reassignedFromEmail" TEXT;
ALTER TABLE "BookingRequest" ADD COLUMN "reassignedById" TEXT;
ALTER TABLE "BookingRequest" ADD COLUMN "reassignedAt" TIMESTAMP(3);
ALTER TABLE "BookingRequest" ADD COLUMN "reassignmentReason" TEXT;

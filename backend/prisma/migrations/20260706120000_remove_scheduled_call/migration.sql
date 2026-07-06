-- Remove the legacy v1 ScheduledCall feature (HIPAA sprint L4).
-- The feature (provider follow-up call scheduling) is retired; dropping the
-- table + enum removes PHI-bearing legacy data from HIPAA audit scope.
-- ScheduledCall is a leaf: its alertId FK is ON DELETE SET NULL (non-cascade)
-- and no other table references it, so this drop touches nothing else.

-- DropForeignKey
ALTER TABLE "ScheduledCall" DROP CONSTRAINT "ScheduledCall_userId_fkey";

-- DropForeignKey
ALTER TABLE "ScheduledCall" DROP CONSTRAINT "ScheduledCall_alertId_fkey";

-- DropTable
DROP TABLE "ScheduledCall";

-- DropEnum
DROP TYPE "CallStatus";

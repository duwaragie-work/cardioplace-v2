-- CreateEnum
CREATE TYPE "EmergencyConfirmationState" AS ENUM ('AWAITING', 'CONFIRMATORY', 'UNCONFIRMED');

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "confirmsEntryId" TEXT,
ADD COLUMN     "emergencyConfirmation" "EmergencyConfirmationState",
ADD COLUMN     "engineEvaluationDeferredUntil" TIMESTAMP(3);

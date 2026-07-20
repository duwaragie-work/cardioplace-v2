-- AlterTable
ALTER TABLE "User" ADD COLUMN     "acknowledgedPolicyVersion" TEXT,
ADD COLUMN     "policyAcknowledgedAt" TIMESTAMP(3);

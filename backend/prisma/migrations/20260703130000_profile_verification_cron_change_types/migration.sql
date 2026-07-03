-- Cron audit attribution (HIPAA §164.312(b), Humaira Activity 1 #3). Additive
-- enum values only. One ADD VALUE per statement (transaction-safe on PG 12+).

-- AlterEnum
ALTER TYPE "VerifierRole" ADD VALUE 'SYSTEM_ACTOR';

-- AlterEnum
ALTER TYPE "VerificationChangeType" ADD VALUE 'SYSTEM_CRON_FINALIZE';

-- AlterEnum
ALTER TYPE "VerificationChangeType" ADD VALUE 'SYSTEM_CRON_MEDICATION_HOLD_ESCALATION';

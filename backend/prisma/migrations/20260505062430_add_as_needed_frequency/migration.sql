-- Adds AS_NEEDED to MedicationFrequency for PRN ("as needed") prescriptions.
-- These meds aren't on a fixed schedule so they should be excluded from the
-- adherence rule + missed-dose alerts (rule engine audit pending).
--
-- ALTER TYPE ... ADD VALUE is non-transactional in Postgres < 12 but is fine
-- on the managed Prisma Postgres (16.x). Existing rows are unaffected; the
-- column already accepts NULL via UNSURE.

ALTER TYPE "MedicationFrequency" ADD VALUE IF NOT EXISTS 'AS_NEEDED';

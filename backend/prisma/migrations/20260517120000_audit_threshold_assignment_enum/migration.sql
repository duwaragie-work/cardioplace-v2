-- Phase 2 — Finding 4 (JCAHO audit completeness).
-- Clinical-staff threshold + care-team-assignment changes previously wrote
-- no ProfileVerificationLog row. Adds two VerificationChangeType members so
-- those actions can be audited (actor + before/after + fieldPath).
--
-- ALTER TYPE ... ADD VALUE is fine on the managed Prisma Postgres (16.x).
-- Existing rows are unaffected. IF NOT EXISTS keeps it idempotent.

ALTER TYPE "VerificationChangeType" ADD VALUE IF NOT EXISTS 'ADMIN_THRESHOLD_UPDATE';
ALTER TYPE "VerificationChangeType" ADD VALUE IF NOT EXISTS 'ADMIN_ASSIGNMENT_CHANGE';

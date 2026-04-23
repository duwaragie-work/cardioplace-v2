-- phase/21 — split clinical enrollment from identity onboarding.
--
-- Previously `User.onboardingStatus` was overloaded: `POST /v2/auth/profile`
-- (patient-side identity onboarding) AND `POST /admin/patients/:id/complete-
-- onboarding` (admin-side clinical enrollment gate) both wrote COMPLETED.
-- That made the enrollment gate effectively dead code for any patient who'd
-- finished basic onboarding, and caused crons (gap-alert, monthly-reask) plus
-- provider "enrolled patients" queries to surface patients who never passed
-- the 4-piece clinical gate.
--
-- Fix: introduce EnrollmentStatus as a second, orthogonal state owned by the
-- admin enrollment endpoint. onboardingStatus keeps its identity meaning
-- (used by /v2/auth/profile + the sign-in onboarding_required flag).

-- ─── 1. EnrollmentStatus enum ─────────────────────────────────────────────
CREATE TYPE "EnrollmentStatus" AS ENUM ('NOT_ENROLLED', 'ENROLLED');

-- ─── 2. User column (additive, default NOT_ENROLLED) ──────────────────────
ALTER TABLE "User"
  ADD COLUMN "enrollmentStatus" "EnrollmentStatus" NOT NULL DEFAULT 'NOT_ENROLLED';

-- ─── 3. Safety backfill ───────────────────────────────────────────────────
-- Any existing PATIENT that today satisfies every enrollment-gate check gets
-- flipped to ENROLLED so dev/staging DBs don't silently lose their
-- already-enrolled patients after this migration lands. Gate mirrors
-- enrollment-gate.ts exactly:
--   1. PatientProviderAssignment exists
--   2. Linked Practice has all three businessHours* columns non-null
--   3. PatientProfile exists
--   4. If HFREF / HCM / DCM, a PatientThreshold exists (HFpEF is optional)
UPDATE "User" u
SET "enrollmentStatus" = 'ENROLLED'
WHERE u."onboardingStatus" = 'COMPLETED'
  AND 'PATIENT' = ANY(u."roles")
  AND EXISTS (
    SELECT 1
    FROM "PatientProviderAssignment" a
    INNER JOIN "Practice" p ON p.id = a."practiceId"
    WHERE a."userId" = u.id
      AND p."businessHoursStart" IS NOT NULL
      AND p."businessHoursEnd" IS NOT NULL
      AND p."businessHoursTimezone" IS NOT NULL
  )
  AND EXISTS (SELECT 1 FROM "PatientProfile" pp WHERE pp."userId" = u.id)
  AND (
    -- Threshold required only when the profile flags HFrEF / HCM / DCM.
    NOT EXISTS (
      SELECT 1 FROM "PatientProfile" pp
      WHERE pp."userId" = u.id
        AND (pp."heartFailureType" = 'HFREF' OR pp."hasHCM" = true OR pp."hasDCM" = true)
    )
    OR EXISTS (SELECT 1 FROM "PatientThreshold" t WHERE t."userId" = u.id)
  );

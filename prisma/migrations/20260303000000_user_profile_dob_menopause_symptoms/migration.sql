-- Migration: user_profile_dob_menopause_symptoms
-- Replaces `age Int?` with richer profile fields for the Healplace onboarding model.

-- Step 1: Create the MenopauseStage enum
CREATE TYPE "MenopauseStage" AS ENUM ('PERIMENOPAUSE', 'MENOPAUSE', 'POSTMENOPAUSE', 'UNKNOWN');

-- Step 2: Add new columns (all nullable or non-null with default — no data loss)
ALTER TABLE "User"
  ADD COLUMN "dateOfBirth"              TIMESTAMP(3),
  ADD COLUMN "menopauseStage"           "MenopauseStage" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "timezone"                 TEXT,
  ADD COLUMN "primarySymptoms"          JSONB,
  ADD COLUMN "primarySymptomsOtherText" TEXT;

-- Step 3: Backfill dateOfBirth from existing age values (best-effort approximation)
-- Sets dateOfBirth to Jan 1 of the estimated birth year.
-- IMPORTANT: This is year-precision only — not an exact birthdate.
UPDATE "User"
SET "dateOfBirth" = make_date(
    EXTRACT(YEAR FROM NOW())::int - "age",
    1,
    1
)::timestamp
WHERE "age" IS NOT NULL
  AND "dateOfBirth" IS NULL;

-- Step 4: Drop the old age column (data has been migrated above)
ALTER TABLE "User" DROP COLUMN "age";

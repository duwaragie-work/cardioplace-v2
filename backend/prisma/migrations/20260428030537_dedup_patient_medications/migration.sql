-- phase/21-medication-dedup
--
-- 1) Cleanup existing duplicate active rows.
--    For each canonical key (userId + lower(drugName) + drugClass + frequency +
--    isCombination + combinationComponents), keep the row preferred by:
--      a) verifiedAt IS NOT NULL first (verified rows trump unverified)
--      b) earliest reportedAt
--      c) earliest id (deterministic tiebreaker)
--    Soft-close the rest by setting discontinuedAt = NOW().
--
-- 2) Add a partial unique index on active rows so the DB itself enforces
--    no-dupes-per-patient going forward. Discontinued rows are excluded so
--    historical re-adds (stop → restart) are still allowed.

WITH ranked AS (
  SELECT
    id,
    "userId",
    LOWER("drugName") AS lname,
    "drugClass",
    "frequency",
    "isCombination",
    "combinationComponents",
    ROW_NUMBER() OVER (
      PARTITION BY "userId", LOWER("drugName"), "drugClass", "frequency",
                   "isCombination", "combinationComponents"
      ORDER BY
        CASE WHEN "verifiedAt" IS NOT NULL THEN 0 ELSE 1 END,
        "reportedAt" ASC,
        id ASC
    ) AS rn
  FROM "PatientMedication"
  WHERE "discontinuedAt" IS NULL
)
UPDATE "PatientMedication" pm
SET "discontinuedAt" = NOW()
FROM ranked r
WHERE pm.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX "uq_patientmed_active"
  ON "PatientMedication" (
    "userId",
    LOWER("drugName"),
    "drugClass",
    "frequency",
    "isCombination",
    "combinationComponents"
  )
  WHERE "discontinuedAt" IS NULL;

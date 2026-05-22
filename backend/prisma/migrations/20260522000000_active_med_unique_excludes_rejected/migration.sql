-- IVR-19 fix — a medication the provider REJECTED is a terminal audit record,
-- not a "current" med, so it must NOT occupy the active-uniqueness slot.
-- Re-adding a rejected drug (option c: warn-then-allow) creates a fresh
-- UNVERIFIED row that has to coexist with the preserved REJECTED row (same
-- userId + drugName + class + frequency). The original partial index only
-- excluded discontinued rows, so the preserved rejected row collided with the
-- re-add and the save failed with a uq_patientmed_active unique violation.
--
-- Fix: also exclude REJECTED rows from the partial unique index. The new index
-- is strictly less restrictive than the old one (narrower WHERE), so any data
-- valid before remains valid — the recreation cannot fail on existing rows.

DROP INDEX "uq_patientmed_active";

CREATE UNIQUE INDEX "uq_patientmed_active"
  ON "PatientMedication" (
    "userId",
    LOWER("drugName"),
    "drugClass",
    "frequency",
    "isCombination",
    "combinationComponents"
  )
  WHERE "discontinuedAt" IS NULL
    AND "verificationStatus" <> 'REJECTED'::"MedicationVerificationStatus";

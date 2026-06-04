-- #85 + #92 — schema additions only. The data backfill + duplicate merge run
-- in the FOLLOWING migration (20260603160000) so the new SYSTEM_MIGRATION enum
-- value is committed before it's referenced (Postgres forbids using a freshly
-- ADDed enum value in the same transaction).

-- #85 — SYSTEM_MIGRATION audit changeType (used by the dedup-merge migration).
ALTER TYPE "VerificationChangeType" ADD VALUE IF NOT EXISTS 'SYSTEM_MIGRATION';

-- #85 — canonical drug identity for brand/generic dedup.
-- #92 — admin-add provenance (who/when entered or last edited a med).
ALTER TABLE "PatientMedication"
  ADD COLUMN "canonicalDrugId"     TEXT,
  ADD COLUMN "addedByUserId"       TEXT,
  ADD COLUMN "addedByRole"         "VerifierRole",
  ADD COLUMN "addedAt"             TIMESTAMP(3),
  ADD COLUMN "lastEditedByUserId"  TEXT,
  ADD COLUMN "lastEditedByRole"    "VerifierRole",
  ADD COLUMN "lastEditedAt"        TIMESTAMP(3);

CREATE INDEX "PatientMedication_userId_canonicalDrugId_idx"
  ON "PatientMedication"("userId", "canonicalDrugId");

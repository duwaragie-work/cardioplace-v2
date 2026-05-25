-- Manisha 2026-05-24 sign-offs (Clinical Clarifications + Medication Workflow).
--
-- Purely additive: one enum, six column additions, one new table. No changes to
-- existing columns or data, so this is safe to apply on top of the prior
-- migrations without backfill.
--
--   1. MedicationHoldReason enum + PatientMedication.holdReason/holdSetAt
--      (Med §3 — structured HOLD reasons drive the two-path patient message +
--      the 7/14/30/45-day reconciliation escalation ladder).
--   2. PatientProfile.hasAorticStenosis (Q5C — new condition) +
--      aceContraindicatedAt/aceContraindicationReason (Q4 — permanent
--      ACE-inhibitor contraindication set on angioedema resolution).
--   3. JournalEntry.narrowPpArtifact (Q1 Tier 2 — per-reading narrow-PP flag).
--   4. DeviationAlert.resolutionDetails (Q4 — structured resolution sub-fields).
--   5. RejectedReadingLog (Q1 Tier 1 — DBP>=SBP readings rejected at entry).

-- ── 1. HOLD reason codes ────────────────────────────────────────────────────
CREATE TYPE "MedicationHoldReason" AS ENUM ('AWAITING_RECORDS', 'UNCLEAR_NAME', 'UNCLEAR_DOSE', 'PROVIDER_DIRECTED_HOLD', 'OTHER');

ALTER TABLE "PatientMedication" ADD COLUMN "holdReason" "MedicationHoldReason";
ALTER TABLE "PatientMedication" ADD COLUMN "holdSetAt" TIMESTAMP(3);
-- holdEscalationLevel anchors the 7/14/30/45-day reconciliation escalation
-- ladder idempotency (0 = none, 1 = day-7, 2 = day-14, 3 = day-30, 4 = day-45).
ALTER TABLE "PatientMedication" ADD COLUMN "holdEscalationLevel" INTEGER NOT NULL DEFAULT 0;

-- ── 2. PatientProfile — aortic stenosis + ACE contraindication ──────────────
ALTER TABLE "PatientProfile" ADD COLUMN "hasAorticStenosis" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PatientProfile" ADD COLUMN "aceContraindicatedAt" TIMESTAMP(3);
ALTER TABLE "PatientProfile" ADD COLUMN "aceContraindicationReason" TEXT;

-- ── 3. JournalEntry — narrow-PP artifact flag ───────────────────────────────
ALTER TABLE "JournalEntry" ADD COLUMN "narrowPpArtifact" BOOLEAN NOT NULL DEFAULT false;

-- ── 4. DeviationAlert — structured resolution sub-fields ────────────────────
ALTER TABLE "DeviationAlert" ADD COLUMN "resolutionDetails" JSONB;

-- ── 5. RejectedReadingLog ───────────────────────────────────────────────────
CREATE TABLE "RejectedReadingLog" (
    "id"          TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "systolicBP"  INTEGER,
    "diastolicBP" INTEGER,
    "pulse"       INTEGER,
    "reason"      TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RejectedReadingLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RejectedReadingLog_userId_createdAt_idx" ON "RejectedReadingLog"("userId", "createdAt" DESC);

ALTER TABLE "RejectedReadingLog" ADD CONSTRAINT "RejectedReadingLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- N6 extension (2026-07-11) — make §164.528 disclosure fields explicit.
--
-- Day 4 shipped a minimal EmailDisclosureLog satisfying §164.528 via proxies
-- (subject ≈ brief description; template ≈ purpose). This migration adds:
--   • purpose enum     — explicit §164.528 "purpose of the disclosure"
--   • briefDescription — explicit §164.528 "brief description of PHI"
--   • bodyHash         — SHA-256 fingerprint per §164.312(c) integrity
--   • recipientCategory — structured "who received it" bucket
--   • senderPracticeContext — multi-practice attribution (CLS activePracticeId)
--
-- Design: the 3 new required columns (purpose, briefDescription, bodyHash,
-- recipientCategory) get a temporary DEFAULT so pre-existing rows populate
-- cleanly, then the DEFAULT is dropped so future inserts must supply values.
-- The Day-4 EmailDisclosureLog table was created 2026-07-10 and has produced
-- no disclosures on the Cloud DB yet, so the backfill applies to zero rows in
-- prod — but the DEFAULT keeps this migration safe on any dev DB that DID.

-- ── New enum types ────────────────────────────────────────────────────────
CREATE TYPE "DisclosurePurpose" AS ENUM (
    'TREATMENT',
    'PAYMENT',
    'HEALTHCARE_OPERATIONS',
    'PATIENT_DIRECTED',
    'CARE_COORDINATION',
    'REQUIRED_BY_LAW',
    'OTHER'
);

CREATE TYPE "RecipientCategory" AS ENUM (
    'PATIENT',
    'CAREGIVER',
    'PROVIDER',
    'MEDICAL_DIRECTOR',
    'COORDINATOR',
    'HEALPLACE_OPS',
    'SUPER_ADMIN',
    'EXTERNAL_UNKNOWN',
    'SYSTEM'
);

-- ── Add columns with temporary defaults for safe backfill ─────────────────
ALTER TABLE "EmailDisclosureLog"
    ADD COLUMN "senderPracticeContext" TEXT,
    ADD COLUMN "purpose" "DisclosurePurpose" NOT NULL DEFAULT 'OTHER',
    ADD COLUMN "briefDescription" TEXT NOT NULL DEFAULT 'legacy row — pre-N6-extension',
    ADD COLUMN "bodyHash" TEXT NOT NULL DEFAULT 'legacy',
    ADD COLUMN "recipientCategory" "RecipientCategory" NOT NULL DEFAULT 'EXTERNAL_UNKNOWN';

-- Drop the DEFAULT once existing rows are backfilled — new inserts must
-- supply an explicit value derived from the template registry at write time.
ALTER TABLE "EmailDisclosureLog"
    ALTER COLUMN "purpose" DROP DEFAULT,
    ALTER COLUMN "briefDescription" DROP DEFAULT,
    ALTER COLUMN "bodyHash" DROP DEFAULT,
    ALTER COLUMN "recipientCategory" DROP DEFAULT;

-- ── New indices supporting the three regulatory query paths ───────────────
CREATE INDEX "EmailDisclosureLog_purpose_sentAt_idx"
    ON "EmailDisclosureLog"("purpose", "sentAt");

CREATE INDEX "EmailDisclosureLog_recipientCategory_sentAt_idx"
    ON "EmailDisclosureLog"("recipientCategory", "sentAt");

CREATE INDEX "EmailDisclosureLog_senderPracticeContext_sentAt_idx"
    ON "EmailDisclosureLog"("senderPracticeContext", "sentAt");

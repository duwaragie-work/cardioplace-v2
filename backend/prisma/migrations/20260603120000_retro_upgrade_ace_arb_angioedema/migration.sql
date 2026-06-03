-- #84 (F13 follow-up) — retro-upgrade existing live ACE inhibitor / ARB
-- medications to PROVIDER_DIRECTED_HOLD for every patient whose permanent
-- angioedema contraindication flag (PatientProfile.aceContraindicatedAt) is set.
--
-- Background: F13 (Sprint 1) only forced a *newly re-added* ACE/ARB into
-- provider review. Rows that already existed when the flag flipped stayed on
-- benign administrative holds (AWAITING_RECORDS, UNCLEAR_NAME, …) or VERIFIED,
-- whose patient-facing message reads "keep taking it as usual" — dangerous for
-- an angioedema-contraindicated patient. This one-time sweep closes that gap.
--
-- NOTE: aceContraindicatedAt lives on PatientProfile (keyed by userId), NOT on
-- User. Discontinued rows are intentionally left alone — they no longer surface
-- to the patient.
--
-- Idempotent: the audit INSERT and the UPDATE both match only rows still on a
-- benign-HOLD or VERIFIED state. After the first run those rows are
-- PROVIDER_DIRECTED_HOLD, so a re-run matches nothing — no duplicate audit
-- rows, no further updates.

-- 1) Audit trail FIRST (JCAHO traceability) — one ProfileVerificationLog row
--    per medication about to be upgraded, capturing the pre-upgrade state.
INSERT INTO "ProfileVerificationLog" (
  "id", "userId", "fieldPath", "previousValue", "newValue",
  "changedBy", "changedByRole", "changeType", "discrepancyFlag", "rationale", "createdAt"
)
SELECT
  gen_random_uuid()::text,
  pm."userId",
  'medication:' || pm."id" || ':holdReason',
  jsonb_build_object('verificationStatus', pm."verificationStatus", 'holdReason', pm."holdReason"),
  jsonb_build_object('verificationStatus', 'HOLD', 'holdReason', 'PROVIDER_DIRECTED_HOLD'),
  'SYSTEM',
  'ADMIN'::"VerifierRole",
  'ADMIN_CORRECT'::"VerificationChangeType",
  true,
  'Angioedema ACE/ARB contraindication retro-upgrade (#84 data migration)',
  CURRENT_TIMESTAMP
FROM "PatientMedication" pm
JOIN "PatientProfile" pp ON pp."userId" = pm."userId"
WHERE pp."aceContraindicatedAt" IS NOT NULL
  AND pm."drugClass" IN ('ACE_INHIBITOR', 'ARB')
  AND pm."discontinuedAt" IS NULL
  AND (
    (pm."verificationStatus" = 'HOLD'
      AND pm."holdReason" IN ('AWAITING_RECORDS', 'UNCLEAR_NAME', 'UNCLEAR_DOSE', 'OTHER'))
    OR pm."verificationStatus" = 'VERIFIED'
  );

-- 2) Upgrade the same rows. A VERIFIED row transitioning into HOLD anchors a
--    fresh reconciliation ladder (holdSetAt = now, holdEscalationLevel = 0);
--    an already-HOLD row keeps its original holdSetAt. SET right-hand sides see
--    the pre-update column values, so the CASE on verificationStatus is correct.
UPDATE "PatientMedication" pm
SET
  "holdReason" = 'PROVIDER_DIRECTED_HOLD',
  "holdSetAt" = CASE
    WHEN pm."verificationStatus" = 'VERIFIED' THEN CURRENT_TIMESTAMP
    ELSE pm."holdSetAt"
  END,
  "holdEscalationLevel" = CASE
    WHEN pm."verificationStatus" = 'VERIFIED' THEN 0
    ELSE pm."holdEscalationLevel"
  END,
  "verificationStatus" = 'HOLD'
FROM "PatientProfile" pp
WHERE pp."userId" = pm."userId"
  AND pp."aceContraindicatedAt" IS NOT NULL
  AND pm."drugClass" IN ('ACE_INHIBITOR', 'ARB')
  AND pm."discontinuedAt" IS NULL
  AND (
    (pm."verificationStatus" = 'HOLD'
      AND pm."holdReason" IN ('AWAITING_RECORDS', 'UNCLEAR_NAME', 'UNCLEAR_DOSE', 'OTHER'))
    OR pm."verificationStatus" = 'VERIFIED'
  );

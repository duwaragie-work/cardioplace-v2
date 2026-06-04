-- #85 — backfill canonicalDrugId from the shared catalog, then merge active
-- brand/generic duplicates (e.g. Cozaar HOLD + Losartan VERIFIED → one row).
--
-- IDEMPOTENT: backfill only fills NULLs; the merge keeps exactly one active row
-- per (userId, canonicalDrugId), so a re-run finds no rank>1 rows and is a
-- no-op. Audit rows are written BEFORE the delete (and the whole migration is
-- one transaction), so the JCAHO trail survives even if it aborts mid-flight.

-- 1) Backfill — exact (case-insensitive) brand/generic match against the shared
--    catalog. Substring-only names ("Lisinopril 10mg") stay NULL on purpose:
--    the runtime write-path (matchToCatalog) resolves those going forward;
--    historical free-text rows are left for provider review, never force-merged.
WITH catalog(alias, canonical) AS (VALUES
    ('prinivil', 'lisinopril'), ('lisinopril', 'lisinopril'),
    ('vasotec', 'enalapril'), ('enalapril', 'enalapril'),
    ('altace', 'ramipril'), ('ramipril', 'ramipril'),
    ('lotensin', 'benazepril'), ('benazepril', 'benazepril'),
    ('cozaar', 'losartan'), ('losartan', 'losartan'),
    ('diovan', 'valsartan'), ('valsartan', 'valsartan'),
    ('avapro', 'irbesartan'), ('irbesartan', 'irbesartan'),
    ('benicar', 'olmesartan'), ('olmesartan', 'olmesartan'),
    ('toprol xl', 'metoprolol'), ('metoprolol', 'metoprolol'),
    ('coreg', 'carvedilol'), ('carvedilol', 'carvedilol'),
    ('tenormin', 'atenolol'), ('atenolol', 'atenolol'),
    ('zebeta', 'bisoprolol'), ('bisoprolol', 'bisoprolol'),
    ('norvasc', 'amlodipine'), ('amlodipine', 'amlodipine'),
    ('procardia', 'nifedipine'), ('nifedipine', 'nifedipine'),
    ('cardizem', 'diltiazem'), ('diltiazem', 'diltiazem'),
    ('calan', 'verapamil'), ('verapamil', 'verapamil'),
    ('lasix', 'furosemide'), ('furosemide', 'furosemide'),
    ('microzide', 'hctz'), ('hydrochlorothiazide', 'hctz'),
    ('aldactone', 'spironolactone'), ('spironolactone', 'spironolactone'),
    ('coumadin', 'warfarin'), ('warfarin', 'warfarin'),
    ('eliquis', 'apixaban'), ('apixaban', 'apixaban'),
    ('xarelto', 'rivaroxaban'), ('rivaroxaban', 'rivaroxaban'),
    ('lipitor', 'atorvastatin'), ('atorvastatin', 'atorvastatin'),
    ('crestor', 'rosuvastatin'), ('rosuvastatin', 'rosuvastatin'),
    ('pacerone', 'amiodarone'), ('amiodarone', 'amiodarone'),
    ('tambocor', 'flecainide'), ('flecainide', 'flecainide'),
    ('jardiance', 'empagliflozin'), ('empagliflozin', 'empagliflozin'),
    ('farxiga', 'dapagliflozin'), ('dapagliflozin', 'dapagliflozin'),
    ('advil', 'ibuprofen'), ('ibuprofen', 'ibuprofen'),
    ('aleve', 'naproxen'), ('naproxen', 'naproxen'),
    ('celebrex', 'celecoxib'), ('celecoxib', 'celecoxib'),
    ('zestoretic', 'zestoretic'), ('hyzaar', 'hyzaar'),
    ('lotrel', 'lotrel'), ('entresto', 'entresto'), ('caduet', 'caduet')
)
UPDATE "PatientMedication" pm
SET "canonicalDrugId" = c.canonical
FROM catalog c
WHERE pm."canonicalDrugId" IS NULL
  AND lower(pm."drugName") = c.alias;

-- 2) Audit BEFORE delete — one ProfileVerificationLog row per duplicate that
--    will be merged away, pointing at the kept (most-restrictive) row.
INSERT INTO "ProfileVerificationLog" (
  "id", "userId", "fieldPath", "previousValue", "newValue",
  "changedBy", "changedByRole", "changeType", "discrepancyFlag", "rationale", "createdAt"
)
SELECT
  gen_random_uuid()::text,
  l."userId",
  'medication:' || l.keeper_id || ':mergedFrom',
  jsonb_build_object(
    'mergedMedicationId', l.id,
    'drugName', l."drugName",
    'verificationStatus', l."verificationStatus",
    'holdReason', l."holdReason"
  ),
  NULL,
  'SYSTEM',
  'ADMIN'::"VerifierRole",
  'SYSTEM_MIGRATION'::"VerificationChangeType",
  true,
  'Brand/generic duplicate merged into kept row (#85 canonical dedup); most-restrictive status retained.',
  CURRENT_TIMESTAMP
FROM (
  SELECT
    id, "userId", "drugName", "verificationStatus", "holdReason",
    row_number() OVER w AS rn,
    first_value(id) OVER w AS keeper_id
  FROM "PatientMedication"
  WHERE "canonicalDrugId" IS NOT NULL AND "discontinuedAt" IS NULL
  WINDOW w AS (
    PARTITION BY "userId", "canonicalDrugId"
    ORDER BY
      CASE
        WHEN "verificationStatus" = 'HOLD' AND "holdReason" = 'PROVIDER_DIRECTED_HOLD' THEN 100
        WHEN "verificationStatus" = 'HOLD' AND "holdReason" = 'AWAITING_RECORDS' THEN 90
        WHEN "verificationStatus" = 'HOLD' AND "holdReason" = 'UNCLEAR_NAME' THEN 80
        WHEN "verificationStatus" = 'HOLD' AND "holdReason" = 'UNCLEAR_DOSE' THEN 75
        WHEN "verificationStatus" = 'HOLD' AND "holdReason" = 'OTHER' THEN 70
        WHEN "verificationStatus" = 'HOLD' THEN 65
        WHEN "verificationStatus" = 'AWAITING_PROVIDER' THEN 50
        WHEN "verificationStatus" = 'VERIFIED' THEN 40
        WHEN "verificationStatus" = 'UNVERIFIED' THEN 20
        WHEN "verificationStatus" = 'REJECTED' THEN 10
        ELSE 0
      END DESC,
      "reportedAt" ASC
  )
) l
WHERE l.rn > 1;

-- 3) Delete the now-audited duplicates (keep rank 1 = most-restrictive).
DELETE FROM "PatientMedication"
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      row_number() OVER w AS rn
    FROM "PatientMedication"
    WHERE "canonicalDrugId" IS NOT NULL AND "discontinuedAt" IS NULL
    WINDOW w AS (
      PARTITION BY "userId", "canonicalDrugId"
      ORDER BY
        CASE
          WHEN "verificationStatus" = 'HOLD' AND "holdReason" = 'PROVIDER_DIRECTED_HOLD' THEN 100
          WHEN "verificationStatus" = 'HOLD' AND "holdReason" = 'AWAITING_RECORDS' THEN 90
          WHEN "verificationStatus" = 'HOLD' AND "holdReason" = 'UNCLEAR_NAME' THEN 80
          WHEN "verificationStatus" = 'HOLD' AND "holdReason" = 'UNCLEAR_DOSE' THEN 75
          WHEN "verificationStatus" = 'HOLD' AND "holdReason" = 'OTHER' THEN 70
          WHEN "verificationStatus" = 'HOLD' THEN 65
          WHEN "verificationStatus" = 'AWAITING_PROVIDER' THEN 50
          WHEN "verificationStatus" = 'VERIFIED' THEN 40
          WHEN "verificationStatus" = 'UNVERIFIED' THEN 20
          WHEN "verificationStatus" = 'REJECTED' THEN 10
          ELSE 0
        END DESC,
        "reportedAt" ASC
    )
  ) ranked
  WHERE ranked.rn > 1
);

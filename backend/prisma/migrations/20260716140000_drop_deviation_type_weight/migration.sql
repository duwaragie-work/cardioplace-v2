-- N-7 (Duwaragie 2026-07-14 triage) — remove WEIGHT from DeviationType.
--
-- Rationale: `legacyTypeFor` at
--   backend/src/daily_journal/services/alert-engine.service.ts:1319
-- never returns 'WEIGHT'. The Cluster 6 rewrite dropped weight-axis
-- deviation alerts entirely — HF-decomp signals now fire via
-- RULE_HF_DECOMPENSATION with the weight delta expressed in the physician
-- message, not through a DeviationAlert.type='WEIGHT' row. Enum value is
-- dead code + shows up in Prisma type unions as a false option.
--
-- Postgres does NOT support `ALTER TYPE ... DROP VALUE` — the standard
-- "recreate + swap" pattern is what runs below.
--
-- IDEMPOTENCY: this migration is one-shot; a mid-migration re-run isn't
-- safe by construction (the type has already been renamed to _old by the
-- first step). If a re-run is needed after partial failure, use
-- `prisma migrate resolve --rolled-back` to reset state then re-run.
--
-- SAFETY: the ALTER TABLE cast at the bottom uses `USING ...::text::...`
-- so any row somehow carrying 'WEIGHT' would fail the migration LOUDLY
-- rather than silently truncate the type. `legacyTypeFor` never emits
-- 'WEIGHT', so a real production DB should have zero such rows.

ALTER TYPE "DeviationType" RENAME TO "DeviationType_old";

CREATE TYPE "DeviationType" AS ENUM (
  'SYSTOLIC_BP',
  'DIASTOLIC_BP',
  'MEDICATION_ADHERENCE'
);

-- DeviationAlert.type is the sole column that uses the enum.
ALTER TABLE "DeviationAlert"
  ALTER COLUMN "type" TYPE "DeviationType"
  USING "type"::text::"DeviationType";

DROP TYPE "DeviationType_old";

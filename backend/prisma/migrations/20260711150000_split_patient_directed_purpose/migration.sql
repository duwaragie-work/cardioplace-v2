-- N6 extension follow-up (2026-07-11) — split PATIENT_DIRECTED into two
-- HIPAA-distinct categories.
--
-- Before this migration, the `DisclosurePurpose` enum's `PATIENT_DIRECTED`
-- value blended:
--   • Disclosures TO the patient themselves (welcome, OTP, account_closed,
--     etc.) — §164.528(a)(1)(i) EXEMPT from accounting.
--   • Disclosures made PER the patient's authorization (§164.508) —
--     ACCOUNTABLE.
--
-- These need to be separately queryable for §164.528 accounting-of-
-- disclosures requests. This migration:
--   1. Renames PATIENT_DIRECTED → DIRECT_TO_PATIENT (all current template
--      uses in the registry are "to the patient" — accounting-exempt).
--   2. Adds PATIENT_AUTHORIZED as a new value for future §164.508 uses.
--
-- Postgres ALTER TYPE ... RENAME VALUE preserves data — no row updates
-- needed. Any existing rows with the old value are automatically re-labelled
-- to the new value.

ALTER TYPE "DisclosurePurpose" RENAME VALUE 'PATIENT_DIRECTED' TO 'DIRECT_TO_PATIENT';
ALTER TYPE "DisclosurePurpose" ADD VALUE 'PATIENT_AUTHORIZED';

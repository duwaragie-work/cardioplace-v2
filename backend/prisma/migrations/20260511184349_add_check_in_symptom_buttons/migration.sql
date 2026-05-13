-- Cluster 6 (Manisha 5/10/26) — patient-driven signals for new engine rules:
--   dizziness    → brady-symptomatic predicate widening; orthostatic; β-blocker side-effect
--   syncope      → brady-symptomatic; general syncope flag
--   palpitations → AFib palpitations; tachy + palpitations; general palpitations
--   legSwelling  → HF decompensation; DHP-CCB side-effect (semantically distinct from
--                  the existing `edema` column which is a preeclampsia trigger).
--
-- All defaults false; backfilled rows interpret "field absent" as "patient
-- did not report this symptom". No data loss.

ALTER TABLE "JournalEntry"
ADD COLUMN     "dizziness"    BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "syncope"      BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "palpitations" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "legSwelling"  BOOLEAN NOT NULL DEFAULT false;

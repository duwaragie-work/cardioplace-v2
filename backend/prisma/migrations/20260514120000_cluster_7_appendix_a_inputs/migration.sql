-- Cluster 7 (Manisha 5/11/26) — Appendix A side-effect + interaction inputs.
--
-- Three additions in a single migration so the engine + admin/UI work that
-- follows can rely on the full surface in one shot:
--
--   1. Four new symptom booleans on JournalEntry — feed A.1 β-blocker
--      fatigue, A.2 β-blocker SOB (HF + non-HF), A.4 ACE-inhibitor dry
--      cough, A.3 NSAID + antihypertensive interaction warning. All
--      default false; existing rows interpret "field absent" as
--      "patient did not report this symptom".
--
--   2. NSAID added to DrugClass enum — supports A.3 NSAID interaction
--      detection via either the per-reading nsaidUse flag OR a chronic
--      NSAID entry in the patient's med list (ibuprofen, naproxen, celecoxib).
--
--   3. HOLD added to MedicationVerificationStatus — supports A.7 admin
--      "Hold" action. When a provider holds a med, the patient receives
--      SYSTEM_MSG_MEDICATION_HOLD in their inbox + the adherence rule
--      suppresses fires on the held med until status returns to VERIFIED.
--
-- The RecipientRole TypeScript union (ladder-defs.ts) gains a CAREGIVER
-- value in code; no DB enum exists for that today (recipientRoles is a
-- String[] on EscalationEvent), so no DDL needed.

-- ── 1. JournalEntry symptom booleans ────────────────────────────────────────
ALTER TABLE "JournalEntry"
ADD COLUMN     "fatigue"           BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shortnessOfBreath" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dryCough"          BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nsaidUse"          BOOLEAN NOT NULL DEFAULT false;

-- ── 2. DrugClass enum bump ──────────────────────────────────────────────────
ALTER TYPE "DrugClass" ADD VALUE IF NOT EXISTS 'NSAID';

-- ── 3. MedicationVerificationStatus enum bump ───────────────────────────────
ALTER TYPE "MedicationVerificationStatus" ADD VALUE IF NOT EXISTS 'HOLD';

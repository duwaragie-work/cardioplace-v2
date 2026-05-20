-- Cluster 8 (Manisha 5/18/26) — ACE-angioedema P0 pilot blocker + Q1/Q2/Q3
-- follow-up sign-off. One migration so the engine + escalation + ramp work
-- that follows can rely on the full surface in one shot:
--
--   1. Two new symptom booleans on JournalEntry — faceSwelling +
--      throatTightness. Either fires the angioedema rule (Tier 1) for ALL
--      patients regardless of medication profile. Default false; existing
--      rows interpret "field absent" as "patient did not report this".
--
--   2. TIER_1_ANGIOEDEMA added to AlertTier — a Tier-1-class
--      (non-dismissable) tier routed to its own compressed escalation
--      ladder (T+0 → T+15m → T+1h → T+4h) rather than the standard Tier 1
--      ladder, because airway obstruction can progress within hours.
--
--   3. T15M + T1H added to LadderStep — the new compressed-ladder rungs.
--
--   4. User.enrolledAt — stamped when enrollmentStatus first flips to
--      ENROLLED. Drives the Q2 CAD-threshold phased ramp ("newly enrolled"
--      = enrolledAt ≥ rollout start) and the Q3 first-month adherence
--      nudge (within 30 days of enrollment). Backfilled = createdAt for
--      already-ENROLLED users so existing patients aren't treated as new.

-- ── 1. JournalEntry symptom booleans ────────────────────────────────────────
ALTER TABLE "JournalEntry"
ADD COLUMN     "faceSwelling"    BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "throatTightness" BOOLEAN NOT NULL DEFAULT false;

-- ── 2. AlertTier enum bump ──────────────────────────────────────────────────
ALTER TYPE "AlertTier" ADD VALUE IF NOT EXISTS 'TIER_1_ANGIOEDEMA';

-- ── 3. LadderStep enum bumps ────────────────────────────────────────────────
ALTER TYPE "LadderStep" ADD VALUE IF NOT EXISTS 'T15M';
ALTER TYPE "LadderStep" ADD VALUE IF NOT EXISTS 'T1H';

-- ── 4. User.enrolledAt + backfill ───────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN "enrolledAt" TIMESTAMP(3);

UPDATE "User"
SET "enrolledAt" = "createdAt"
WHERE "enrollmentStatus" = 'ENROLLED' AND "enrolledAt" IS NULL;

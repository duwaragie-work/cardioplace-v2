-- Phase/7 escalation ladder schema.
--
-- 1. Add T2H to LadderStep (BP Level 2 ladder: T+0 / T+2h / T+4h). T4H is
--    reused across Tier 1 and BP Level 2 — ladder-defs.ts disambiguates by
--    alert.tier.
-- 2. Drop @@unique([journalEntryId, type]) on DeviationAlert. v2 allows
--    multiple alerts per entry (e.g. Tier 3 pulse-pressure alongside Tier 1
--    contraindication). Engine dedupes at app level on (journalEntryId, ruleId).
--    A non-unique index on (journalEntryId, ruleId) replaces the dropped unique
--    to keep the dedup lookup fast.
-- 3. Add @@unique([alertId, escalationEventId, userId, channel]) on
--    Notification — cron retry idempotency, prevents double-sends.
-- 4. Add scheduledFor + triggeredByResolution to EscalationEvent. BP L2
--    resolution action "Unable to reach patient — will retry" creates a fresh
--    T+4h EscalationEvent; the cron dispatches at scheduledFor instead of
--    computing from the normal ladder offset.

-- ─── 1. LadderStep enum: add T2H ──────────────────────────────────────────
ALTER TYPE "LadderStep" ADD VALUE 'T2H' AFTER 'T0';

-- ─── 2. DeviationAlert: drop legacy unique, add dedup-lookup index ────────
ALTER TABLE "DeviationAlert" DROP CONSTRAINT IF EXISTS "DeviationAlert_journalEntryId_type_key";
DROP INDEX IF EXISTS "DeviationAlert_journalEntryId_type_key";
CREATE INDEX IF NOT EXISTS "DeviationAlert_journalEntryId_ruleId_idx"
  ON "DeviationAlert"("journalEntryId", "ruleId");

-- ─── 3. Notification: cron retry idempotency unique ───────────────────────
-- Null-safe: when alertId / escalationEventId are NULL, Postgres treats each
-- NULL as distinct so standalone patient notifications (no alert/escalation
-- linkage) are never conflicted.
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_alertId_escalationEventId_userId_channel_key"
  ON "Notification"("alertId", "escalationEventId", "userId", "channel");

-- ─── 4. EscalationEvent: scheduledFor + triggeredByResolution ─────────────
ALTER TABLE "EscalationEvent"
  ADD COLUMN IF NOT EXISTS "scheduledFor" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "triggeredByResolution" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "EscalationEvent_scheduledFor_idx"
  ON "EscalationEvent"("scheduledFor");

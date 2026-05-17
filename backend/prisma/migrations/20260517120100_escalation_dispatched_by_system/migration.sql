-- Phase 2 — Finding 5 (JCAHO system-vs-human attribution).
-- Adds an explicit dispatchedBySystem flag to EscalationEvent. Cron-fired
-- ladder rungs set it true; admin-scheduled BP_L2 retries set it false.
-- Replaces the admin-UI heuristic with a persisted, queryable audit fact.
-- Additive, NOT NULL with a default so existing rows are unaffected
-- (historical rows default to false; they predate the flag and the UI
-- still falls back to the triggeredByResolution signal for them).

ALTER TABLE "EscalationEvent" ADD COLUMN "dispatchedBySystem" BOOLEAN NOT NULL DEFAULT false;

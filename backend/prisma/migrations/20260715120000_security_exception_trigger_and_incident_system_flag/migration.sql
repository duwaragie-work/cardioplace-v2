-- Real-time failed-auth paging (2026-07-15) — HIPAA §164.308(a)(6) Security
-- Incident Procedures. Two additive changes for the event-driven path that
-- pages HEALPLACE_OPS the moment a repeated-failed-auth burst is detected,
-- instead of waiting up to ~24h for the 03:00 audit-exception cron.
--
--   1. NotificationTrigger gains SECURITY_EXCEPTION — the trigger the
--      real-time evaluator stamps on the ops notification. It is not an
--      ALERT_* value, so the shared BELL_VISIBLE_NOTIFICATION_FILTER shows it
--      in the bell with no further code change.
--
--   2. SecurityIncident gains openedBySystem — true when the evaluator
--      auto-opened the incident (at CRITICAL). openedByOpsId is then the
--      `audit-exception-report` system principal, which staff-list queries
--      filter out, so the worklist UI keys off this flag to render "Opened
--      automatically" rather than an empty opener name. Defaults false, so
--      every existing human-escalated incident is unaffected.
--
-- Both are purely additive. ALTER TYPE ... ADD VALUE preserves all existing
-- rows; the new enum value is not referenced in this migration, so it is safe
-- in a single transaction on Postgres 12+.

ALTER TYPE "NotificationTrigger" ADD VALUE 'SECURITY_EXCEPTION';

ALTER TABLE "SecurityIncident" ADD COLUMN "openedBySystem" BOOLEAN NOT NULL DEFAULT false;

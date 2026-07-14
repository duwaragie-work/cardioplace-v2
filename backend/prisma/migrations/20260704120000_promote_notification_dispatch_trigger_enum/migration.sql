-- Promote Notification.dispatchTrigger from free TEXT to the NotificationTrigger
-- enum, so the bell-vs-alerts tab split can key off it (not the nullable
-- `alertId`). Done in place — the column keeps its data. The auto-generated
-- Prisma migration wanted to DROP + recreate the column (data loss); this
-- hand-written version backfills every NULL to a valid label and then casts the
-- column type, so no row is lost. Column stays NULLABLE here; a later migration
-- (…_notification_dispatch_trigger_not_null) adds NOT NULL once every dispatch
-- path is guaranteed to set it. See project_notification_tab_split_2026_06_04.

-- CreateEnum
CREATE TYPE "NotificationTrigger" AS ENUM (
  'ALERT_CREATED',
  'ALERT_ESCALATION',
  'ALERT_RESOLVED',
  'EMERGENCY_FLAGGED',
  'CAREGIVER_UPDATE',
  'CARE_TEAM_UPDATE',
  'THRESHOLD_UPDATED',
  'MEDICATION_CONTRAINDICATION',
  'PROFILE_REJECTED',
  'CALL_SCHEDULED',
  'SUPPORT_REPLY',
  'SUPPORT_TICKET_CREATED',
  'SUPPORT_RESOLVE',
  'MFA_RESET',
  'SYSTEM_CRON',
  'SYSTEM_ONBOARDING',
  'SYSTEM_SEED',
  'SYSTEM_OTHER'
);

-- ── Backfill (column still TEXT) ────────────────────────────────────────────
-- After this block every row has a non-NULL, valid label so the cast below
-- cannot fail and the positive bell filter is unambiguous. LIKE uses '%' where
-- the real title has an em dash, to keep this file pure ASCII.

-- 1) Chat/voice emergency care-team pages. These have NO DeviationAlert backing
--    (EmergencyEvent, not DeviationAlert) so they never appear in the Alerts
--    stream and MUST stay visible in the bell. Covers legacy NULL rows AND rows
--    tagged 'ALERT_ESCALATION' before the bell filter keyed off dispatchTrigger.
UPDATE "Notification" SET "dispatchTrigger" = 'EMERGENCY_FLAGGED'
  WHERE ("dispatchTrigger" IS NULL OR "dispatchTrigger" = 'ALERT_ESCALATION')
    AND "alertId" IS NULL
    AND title LIKE 'URGENT%Cardioplace patient emergency';

-- 2) Alert-class rows (linked to an alert, or ladder / emergency-titled). This
--    is the leak fix for pre-existing orphans: a ladder Notification whose
--    alertId was nulled by the DeviationAlert cascade (journal-entry delete ->
--    onDelete:SetNull) is re-classified by its title so it stays HIDDEN.
UPDATE "Notification" SET "dispatchTrigger" = 'ALERT_CREATED'
  WHERE "dispatchTrigger" IS NULL
    AND (
      "alertId" IS NOT NULL
      OR title LIKE '[T%'                       -- provider/MD/ops ladder rows: "[T0] BP EMERGENCY ..."
      OR title LIKE '%BP EMERGENCY%'
      OR title = 'Urgent Blood Pressure Alert'  -- patient PUSH, BP Level 2
      OR title LIKE 'Urgent%get medical help now' -- patient PUSH, angioedema
      OR title = 'Cardioplace Alert'            -- patient PUSH, BP Level 1
    );

-- 3) Known non-alert action titles.
UPDATE "Notification" SET "dispatchTrigger" = 'CARE_TEAM_UPDATE'
  WHERE "dispatchTrigger" IS NULL AND title = 'Care team update';
UPDATE "Notification" SET "dispatchTrigger" = 'THRESHOLD_UPDATED'
  WHERE "dispatchTrigger" IS NULL AND title = 'Monitoring targets updated';
UPDATE "Notification" SET "dispatchTrigger" = 'SUPPORT_REPLY'
  WHERE "dispatchTrigger" IS NULL AND title LIKE 'Support%';

-- 4) Catch-all: anything still NULL is a non-alert action/system row -> stays
--    visible in the bell. Never defaults to ALERT_* (that would hide an action).
UPDATE "Notification" SET "dispatchTrigger" = 'SYSTEM_OTHER'
  WHERE "dispatchTrigger" IS NULL;

-- ── Convert TEXT -> enum in place ───────────────────────────────────────────
ALTER TABLE "Notification"
  ALTER COLUMN "dispatchTrigger" TYPE "NotificationTrigger"
  USING ("dispatchTrigger"::"NotificationTrigger");

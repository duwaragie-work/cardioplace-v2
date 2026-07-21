-- Support-notification deep-link + patient-side triggers.
--
-- Hand-authored / applied via `prisma migrate deploy` for the same reason as
-- 20260720120000 (the boot-created HNSW index drift makes `migrate dev` offer
-- to reset the shared dev DB). Additive + idempotent.

-- Deep-link target so the bell can route into the specific ticket thread.
ALTER TABLE "Notification" ADD COLUMN "supportTicketId" TEXT;

-- Patient-side support triggers (both ops-facing, visible in the bell — they
-- are not ALERT_* so the notIn(ALERT_TRIGGERS) bell filter shows them).
ALTER TYPE "NotificationTrigger" ADD VALUE IF NOT EXISTS 'SUPPORT_USER_REPLIED';
ALTER TYPE "NotificationTrigger" ADD VALUE IF NOT EXISTS 'SUPPORT_REOPENED';

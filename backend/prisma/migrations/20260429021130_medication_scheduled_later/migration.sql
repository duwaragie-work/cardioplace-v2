-- Phase/26 silent-literacy — adds medicationScheduledLater to JournalEntry.
-- The patient can now flag a med as "not due yet / scheduled later" so the
-- adherence rule + gap-alert cron know the gap is intentional rather than
-- a missed dose. Default false so existing rows stay valid; no backfill.

ALTER TABLE "JournalEntry"
  ADD COLUMN "medicationScheduledLater" BOOLEAN NOT NULL DEFAULT false;

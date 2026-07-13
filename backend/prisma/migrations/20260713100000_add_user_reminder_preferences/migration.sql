-- N1 (2026-07-13) — Reminder & Engagement preferences on User
--
-- Adds three nullable "HH:mm" wall-clock preferences the daily-reminder cron
-- (N2) reads to decide when to fire and when to be quiet. All three carry
-- sensible defaults so existing rows are safe without a backfill pass.
--
-- Semantics: patient-local wall clock, resolved against User.timezone (default
-- America/New_York) via Intl.DateTimeFormat at read time. String comparison
-- against the formatter's output — no timezone math on the stored value.
--
-- See docs/CLINICAL_SPEC.md and backend/prisma/schema/user.prisma for the
-- design rationale + UI slot constraints (30-min increments, 06:00–21:00
-- for reminderTime).
ALTER TABLE "User" ADD COLUMN "reminderTime"    TEXT DEFAULT '09:00';
ALTER TABLE "User" ADD COLUMN "quietHoursStart" TEXT DEFAULT '22:00';
ALTER TABLE "User" ADD COLUMN "quietHoursEnd"   TEXT DEFAULT '07:00';

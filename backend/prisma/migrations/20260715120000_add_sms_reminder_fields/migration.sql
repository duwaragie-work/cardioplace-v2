-- SMS reminders (L1 + L4, 2026-07-14 — Lakshitha).
--
-- SMS is an ADDITIVE 4th channel on the N2 reminder dispatcher; it never
-- replaces in-app / push / email. The message is PHI-free and directional
-- ("You have a reminder waiting. Tap here to check in: <link>"), so none of
-- these columns carry clinical content.
--
-- L1 — User SMS columns:
--   phoneNumber      EncryptionService envelope (AES-256-GCM), never plaintext.
--                    Same at-rest treatment as the MFA TOTP secret. Read only
--                    on the SMS send path; never returned to a client.
--   smsConsent*      Opt-in ONLY (never pre-checked). consentAt + consentMethod
--                    are the TCPA / §164.528 record, retained enrollment + 6y.
--   smsOptedOut      Set on a STOP reply. Twilio honours it carrier-side, but
--                    the send path MUST refuse too — never trust the provider
--                    alone.
--
-- L4 — NotificationChannel gains SMS so an SMS Notification row is a
-- first-class send record. NOTE: the pre-existing `PHONE` value is the
-- escalation ladder's VOICE channel — deliberately distinct from SMS.
--
-- All columns are nullable / defaulted, so this is safe against existing rows
-- and needs no backfill. Adding an enum value is additive and non-breaking.

-- ── L4: NotificationChannel += SMS ────────────────────────────────────────
ALTER TYPE "NotificationChannel" ADD VALUE 'SMS';

-- ── L1: User SMS columns ──────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN "phoneNumber" TEXT;
ALTER TABLE "User" ADD COLUMN "smsConsent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "smsConsentAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "smsConsentMethod" TEXT;
ALTER TABLE "User" ADD COLUMN "smsOptedOut" BOOLEAN NOT NULL DEFAULT false;

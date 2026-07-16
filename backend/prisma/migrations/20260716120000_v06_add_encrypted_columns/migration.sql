-- V-06 field encryption (Ruhaim 2026-07-16 addendum) — add nullable *Encrypted
-- sibling columns for 14 high-sensitivity free-text fields across 7 models.
--
-- Buckets (from the addendum):
--   • Transcripts       — Conversation.userMessage/aiSummary, Session.title/summary
--   • Symptoms          — JournalEntry.otherSymptoms/teachBackAnswer
--   • Notes             — JournalEntry.notes, PatientThreshold.notes,
--                         EscalationEvent.reason, ProfileVerificationLog.rationale
--   • Med/condition ft  — PatientMedication.notes/rawInputText/plainLanguageDescription,
--                         PatientProfile.aceContraindicationReason
--
-- WHY sibling columns (not encrypt-in-place): mirrors the TotpCredential
-- .secretEncrypted pattern already in prod. Plaintext stays intact as a bake-
-- period safety valve — a misconfigured MFA_ENCRYPTION_KEY cannot brick user-
-- visible reads. Follow-up PR (after prod verifies clean decryption for a week)
-- flips reads to *Encrypted with plaintext fallback, then drops plaintext
-- columns in a final PR.
--
-- Envelope format (EncryptionService.encrypt): "ivHex:tagHex:ciphertextHex"
-- (AES-256-GCM, 12-byte IV, 16-byte auth tag). Stored as plain TEXT.
--
-- Explicitly OUT OF SCOPE for V-06:
--   • PatientMedication.drugName          — canonical dedup depends on it (matchToCatalog)
--   • DeviationAlert.*Message + rationale — rule-templated 3-tier output; separate item
--   • Notification.title/body/tips        — downstream push surface; separate pathway
--   • SupportTicket*.body/subject         — support-module PII; belongs with N-1 fix
--   • EmergencyEvent.prompt / emergency_situation — revisit after V-06 lands
--   • ProfileVerificationLog.previousValue/newValue (Json) — JSON-aware treatment
--   • Numeric BP/pulse/weight             — Ruhaim deferred (SQL vs in-app aggregation)
--
-- IDEMPOTENCY: every column is added with IF NOT EXISTS. Re-running the
-- migration on a DB that already has the columns is a no-op. No data mutation
-- in this step — the accompanying backfill script (v06-backfill-encryption.ts)
-- populates the encrypted siblings after the app rolls out with dual-write.
--
-- LOCK SAFETY: nullable ADD COLUMN with no DEFAULT is a Postgres 11+ metadata-
-- only change — no table rewrite, brief exclusive lock on the pg_class row only.
-- Safe against a live production table.

-- Transcripts (voice + chat)
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "userMessageEncrypted" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "aiSummaryEncrypted"   TEXT;
ALTER TABLE "Session"      ADD COLUMN IF NOT EXISTS "titleEncrypted"       TEXT;
ALTER TABLE "Session"      ADD COLUMN IF NOT EXISTS "summaryEncrypted"     TEXT;

-- Symptoms + patient notes on readings. otherSymptomsEncrypted holds the
-- encrypted JSON-stringified String[] (single envelope for the whole array).
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "otherSymptomsEncrypted"   TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "teachBackAnswerEncrypted" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "notesEncrypted"           TEXT;

-- Notes across clinical models
ALTER TABLE "PatientThreshold"       ADD COLUMN IF NOT EXISTS "notesEncrypted"     TEXT;
ALTER TABLE "EscalationEvent"        ADD COLUMN IF NOT EXISTS "reasonEncrypted"    TEXT;
ALTER TABLE "ProfileVerificationLog" ADD COLUMN IF NOT EXISTS "rationaleEncrypted" TEXT;

-- Medication free-text (drugName intentionally NOT encrypted here — see header)
ALTER TABLE "PatientMedication" ADD COLUMN IF NOT EXISTS "notesEncrypted"                    TEXT;
ALTER TABLE "PatientMedication" ADD COLUMN IF NOT EXISTS "rawInputTextEncrypted"             TEXT;
ALTER TABLE "PatientMedication" ADD COLUMN IF NOT EXISTS "plainLanguageDescriptionEncrypted" TEXT;

-- Condition free-text (only free-text on PatientProfile; conditions are booleans)
ALTER TABLE "PatientProfile" ADD COLUMN IF NOT EXISTS "aceContraindicationReasonEncrypted" TEXT;

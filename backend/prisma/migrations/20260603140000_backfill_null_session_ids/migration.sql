-- #91 — backfill orphaned null-session JournalEntry rows.
--
-- The create path (resolveCreateSessionId) now always assigns a sessionId — it
-- joins an open in-window session or mints a fresh UUID, never null. This
-- migration cleans up the pre-existing null-session rows that the old code
-- left behind (a reading created just after a session finalized, or via a
-- voice/chat path that passed no sessionId), so downstream session grouping
-- (SessionAverager, AFib ≥3-reading gate) never encounters a null session.
--
-- Each orphaned row gets its OWN fresh session id (gen_random_uuid() is
-- evaluated per row). Historical readings that happened to share a null
-- proximity-window are split into separate single-reading sessions — acceptable
-- for already-fired historical data per the Handoff 3 #91 spec ("give each its
-- own session"). Idempotent: only rows still NULL are touched, so a re-run is a
-- no-op.
UPDATE "JournalEntry"
SET "sessionId" = gen_random_uuid()::text
WHERE "sessionId" IS NULL;

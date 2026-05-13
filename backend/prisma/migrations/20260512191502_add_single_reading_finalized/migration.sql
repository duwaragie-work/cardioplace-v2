-- Cluster 6 Q2 (Manisha 5/9/26) — JournalEntry.singleReadingFinalized.
--
-- Flipped by POST /api/daily-journal/:id/finalize-single-reading after the
-- patient's 5-minute "take a second reading" window times out. Engine reads
-- this to bypass the non-emergency single-reading gate so the alert fires
-- on the lone reading with a "confirm with next session" annotation.
--
-- All existing rows interpret as `false` (default) — no backfill needed.

ALTER TABLE "JournalEntry"
ADD COLUMN     "singleReadingFinalized" BOOLEAN NOT NULL DEFAULT false;

// BP reading-session timing constants — single source of truth shared by the
// backend rule engine + the patient check-in UI.
//
// Per Dr. Singal's signed-off CLINICAL_SPEC.md §5.2 (Manisha 2026-05-09 Q2) the
// session is a single 5-minute clock: readings group ("5-minute rolling window")
// and a lone reading is finalized if no second one arrives within 5 minutes.
// Both constants therefore hold 5 minutes; they're kept separate because they
// model distinct concepts (grouping window vs. finalize deadline) even though
// the spec gives them the same value.

/**
 * How long after the most recent reading a session stays "open": readings taken
 * within this window of each other average into one sitting, and the check-in UI
 * offers to add a new reading to the existing session. After it elapses the
 * session is expired and a fresh one begins. (CLINICAL_SPEC §5.2 — 5-min window.)
 */
export const SESSION_WINDOW_MS = 5 * 60 * 1000; // 5 min — CLINICAL_SPEC §5.2

/**
 * How long to wait for a second reading before a lone reading's session is
 * finalized (`JournalEntry.singleReadingFinalized = true`) so its single-reading
 * informational alert fires. Drives the frontend timer AND the server-side
 * expiry-finalize cron. (CLINICAL_SPEC §5.2 — 5-min finalize timeout.)
 */
export const SINGLE_READING_FINALIZE_MS = 5 * 60 * 1000; // 5 min — CLINICAL_SPEC §5.2

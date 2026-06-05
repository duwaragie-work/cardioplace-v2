-- Q7 (Manisha 2026-06-02) — rename PatientProfile.historyPreeclampsia →
-- historyHDP. Per ACOG Practice Bulletin 222, gestational hypertension and
-- preeclampsia share acute monitoring (same severe-range threshold ≥160/110,
-- same symptom surveillance), so a single combined "history of hypertensive
-- disorder of pregnancy (HDP)" flag is clinically appropriate for MVP.
-- Subtypes (preeclampsia / gestational HTN / HELLP) are deferred to Phase 2.
--
-- RENAME COLUMN preserves existing boolean data in place (a drop+add would
-- lose it). No engine threshold logic changes — identifier rename only.
ALTER TABLE "PatientProfile" RENAME COLUMN "historyPreeclampsia" TO "historyHDP";

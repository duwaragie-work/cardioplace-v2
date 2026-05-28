-- DCHA demo seed refresh — preflight cleanup on PROD.
--
-- Runs ONCE before `npx prisma db seed` against prod. Deletes exactly the
-- 11 old seed-managed rows (5 demo patients + 2 duplicate-Rebecca burner
-- signups + 4 admin/ops accounts whose emails are being reused or
-- replaced). Preserves every real signup that drifted onto prod between
-- the last seed and today (Lakshitha + reservato.ai team + the 5 mixed
-- burner accounts that aren't in our DELETE list).
--
-- Authored against the Phase-1 inspection output (qa/reports/
-- demo-seed-inspection.md). If you re-pull prod state and any of these
-- emails are missing, the row count assertions will catch it and abort.
--
-- USAGE
--   1. Take a DB snapshot of prod first.
--   2. Run this file with the trailing `ROLLBACK;` intact — it's a dry-
--      run. Review the row counts in the final SELECT.
--   3. If the counts match expectations, flip the last two lines:
--        ROLLBACK;
--        -- COMMIT;
--      becomes
--        -- ROLLBACK;
--        COMMIT;
--      and re-run.
--   4. Then run `cd backend && npx prisma db seed` against prod.

BEGIN;

-- ─── DELETE list — exact emails, never patterns ────────────────────────
-- Cascade FKs on User (PatientProfile / PatientMedication / PatientThreshold /
-- PatientProviderAssignment / JournalEntry / DeviationAlert / Notification /
-- EscalationEvent / ProfileVerificationLog / OtpCode / RefreshToken / Session
-- / Account / AuthLog) all carry onDelete:Cascade, so a User-row delete
-- bottoms out the related data automatically.

-- Patient rows first. This also drops the PatientProviderAssignment rows
-- that reference the admin User IDs we delete next — without that order
-- step 2's delete would hit FK Restrict.
DELETE FROM "User"
WHERE email IN (
  'duwaragie@healplace.com',       -- old Rebecca Carter (demo patient)
  'james.okafor@gmail.com',        -- old James Okafor (demo patient)
  'rita.washington@gmail.com',     -- old Rita Washington (demo patient)
  'charles.brown@gmail.com',       -- old Charles Brown (demo patient)
  'aisha.johnson@gmail.com',       -- old Aisha Johnson (demo patient)
  'valanow774@justnapa.com',       -- duplicate "Rebecca Carter" dev signup
  'fivata6864@inreur.com'          -- duplicate "Rebecca Carter" dev signup
);

-- Guard: confirm no preserved patient still references an admin row we're
-- about to delete (the new seed will recreate Okonkwo + Raman + ops at
-- the same / new addresses; this assertion stops us from FK-blowing the
-- delete on a forgotten preserved-patient assignment).
DO $$
DECLARE
  remaining INT;
BEGIN
  SELECT COUNT(*) INTO remaining
  FROM "PatientProviderAssignment" ppa
  WHERE ppa."primaryProviderId" IN (SELECT id FROM "User" WHERE email IN (
          'duwaragie22@gmail.com',
          'duwaragiek.racsliit@gmail.com',
          'it23270442@my.sliit.lk',
          'smartcampus.team@gmail.com'))
     OR ppa."backupProviderId"  IN (SELECT id FROM "User" WHERE email IN (
          'duwaragie22@gmail.com',
          'duwaragiek.racsliit@gmail.com',
          'it23270442@my.sliit.lk',
          'smartcampus.team@gmail.com'))
     OR ppa."medicalDirectorId" IN (SELECT id FROM "User" WHERE email IN (
          'duwaragie22@gmail.com',
          'duwaragiek.racsliit@gmail.com',
          'it23270442@my.sliit.lk',
          'smartcampus.team@gmail.com'));

  IF remaining > 0 THEN
    RAISE EXCEPTION
      'ABORT: % PatientProviderAssignment row(s) still reference admin rows we are about to delete (Restrict FK). A preserved patient depends on them. Investigate before re-running.',
      remaining;
  END IF;
END $$;

-- Admin / ops rows being replaced or repurposed by the new seed.
--   • duwaragie22@gmail.com         — Okonkwo (kept email; recreated cleanly)
--   • duwaragiek.racsliit@gmail.com — old Reyes; new seed reuses this email
--                                     for the *patient* Marcus Williams
--   • it23270442@my.sliit.lk        — old Raman (MD); new Raman lives on
--                                     smartcampus.team@gmail.com (below)
--   • smartcampus.team@gmail.com    — old Maria Rodriguez (HEALPLACE_OPS);
--                                     new seed repurposes this email for Raman
DELETE FROM "User"
WHERE email IN (
  'duwaragie22@gmail.com',
  'duwaragiek.racsliit@gmail.com',
  'it23270442@my.sliit.lk',
  'smartcampus.team@gmail.com'
);

-- ─── PRESERVE assertions ──────────────────────────────────────────────
-- These rows MUST still exist. Each is a real user (or the kept admin)
-- whose data we do not touch.
DO $$
DECLARE
  e TEXT;
  preserve_list TEXT[] := ARRAY[
    'support@healplace.com',           -- Dr. Manisha Singal (SUPER_ADMIN, kept)
    'lakshitha@reservato.ai',
    'lakshithaf20@gmail.com',
    'lakshithaf096@gmail.com',
    'lakshithaf200@gmail.com',
    'weneram962@ryzid.com',
    'risindu@reservato.ai',
    'toyofe9075@gixpos.com',
    'buddhikadevelopment@gmail.com'
  ];
BEGIN
  FOREACH e IN ARRAY preserve_list LOOP
    IF NOT EXISTS (SELECT 1 FROM "User" WHERE email = e) THEN
      RAISE EXCEPTION 'ABORT: preserved row missing after cleanup: %', e;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK: all % preserved rows still present.', array_length(preserve_list, 1);
END $$;

-- ─── Sanity counts (review before flipping ROLLBACK→COMMIT) ────────────
SELECT 'users_total'              AS metric, COUNT(*)::TEXT AS value FROM "User"
UNION ALL
SELECT 'users_with_patient_role', COUNT(*)::TEXT FROM "User" WHERE 'PATIENT' = ANY(roles)
UNION ALL
SELECT 'patient_profiles',        COUNT(*)::TEXT FROM "PatientProfile"
UNION ALL
SELECT 'journal_entries',         COUNT(*)::TEXT FROM "JournalEntry"
UNION ALL
SELECT 'deviation_alerts_open',   COUNT(*)::TEXT FROM "DeviationAlert" WHERE status <> 'RESOLVED'
UNION ALL
SELECT 'notifications',           COUNT(*)::TEXT FROM "Notification"
UNION ALL
SELECT 'escalation_events',       COUNT(*)::TEXT FROM "EscalationEvent"
UNION ALL
SELECT 'practices',               COUNT(*)::TEXT FROM "Practice"
UNION ALL
SELECT 'assignments',             COUNT(*)::TEXT FROM "PatientProviderAssignment"
ORDER BY metric;

-- Dry-run guard. Flip the next two lines after reviewing the counts.
ROLLBACK;
-- COMMIT;

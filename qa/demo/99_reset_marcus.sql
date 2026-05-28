-- DCHA demo seed refresh — between-takes reset for Marcus Williams.
--
-- Wipes only the data Marcus created during the previous recording take so
-- the next take starts from the same lived-in 9-entry baseline. Scope:
--   • JournalEntry rows created in the last hour
--   • DeviationAlert rows created in the last hour
--   • EscalationEvent rows triggered in the last hour
--   • Notification rows sent in the last hour, addressed to Marcus *or*
--     about Marcus (patientUserId match)
--
-- Hardcoded to Marcus's prod email — `duwaragiek.racsliit@gmail.com`. Never
-- expanded to other patients. Run as a DRY-RUN first (`ROLLBACK` at the
-- bottom is intentional); flip to `COMMIT` after the assertion confirms his
-- 9 lived-in entries survived.
--
-- USAGE between takes
--   1. Run as-is (dry-run).
--   2. Review the row counts.
--   3. Flip the last two lines (ROLLBACK <-> COMMIT) and re-run.

BEGIN;

-- Notifications about or to Marcus, sent in last hour.
DELETE FROM "Notification" n
USING "User" u
WHERE u.email = 'duwaragiek.racsliit@gmail.com'
  AND (n."userId" = u.id OR n."patientUserId" = u.id)
  AND n."sentAt" > NOW() - INTERVAL '1 hour';

-- Escalation events triggered in last hour.
DELETE FROM "EscalationEvent" ee
USING "User" u
WHERE u.email = 'duwaragiek.racsliit@gmail.com'
  AND ee."userId" = u.id
  AND ee."triggeredAt" > NOW() - INTERVAL '1 hour';

-- Deviation alerts created in last hour.
DELETE FROM "DeviationAlert" da
USING "User" u
WHERE u.email = 'duwaragiek.racsliit@gmail.com'
  AND da."userId" = u.id
  AND da."createdAt" > NOW() - INTERVAL '1 hour';

-- Journal entries created in last hour (Marcus's live readings from the take).
DELETE FROM "JournalEntry" j
USING "User" u
WHERE u.email = 'duwaragiek.racsliit@gmail.com'
  AND j."userId" = u.id
  AND j."createdAt" > NOW() - INTERVAL '1 hour';

-- Assert his 9 lived-in entries are still present.
DO $$
DECLARE
  entry_count INT;
BEGIN
  SELECT COUNT(*) INTO entry_count
  FROM "JournalEntry" j
  JOIN "User" u ON u.id = j."userId"
  WHERE u.email = 'duwaragiek.racsliit@gmail.com';

  IF entry_count <> 9 THEN
    RAISE EXCEPTION
      'ABORT: Marcus lived-in entry count = % (expected 9). Reset would corrupt the lived-in baseline.',
      entry_count;
  END IF;
  RAISE NOTICE 'OK: Marcus has 9 lived-in entries remaining (baseline intact).';
END $$;

-- Counts for review.
SELECT 'marcus_journal_entries_remaining' AS metric, COUNT(*)::TEXT AS value
FROM "JournalEntry" j
JOIN "User" u ON u.id = j."userId"
WHERE u.email = 'duwaragiek.racsliit@gmail.com'
UNION ALL
SELECT 'marcus_open_alerts_remaining', COUNT(*)::TEXT
FROM "DeviationAlert" da
JOIN "User" u ON u.id = da."userId"
WHERE u.email = 'duwaragiek.racsliit@gmail.com'
  AND da.status <> 'RESOLVED'
UNION ALL
SELECT 'marcus_notifications_remaining', COUNT(*)::TEXT
FROM "Notification" n
JOIN "User" u ON u.email = 'duwaragiek.racsliit@gmail.com'
WHERE n."userId" = u.id OR n."patientUserId" = u.id;

-- Dry-run guard. Flip after confirming the counts.
ROLLBACK;
-- COMMIT;

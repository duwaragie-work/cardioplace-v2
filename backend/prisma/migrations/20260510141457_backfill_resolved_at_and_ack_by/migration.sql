-- Backfill the two new audit columns from EscalationEvent rows where
-- possible. Bug #2 (acknowledgedByUserId) and #8 (resolvedAt) per
-- BUG_BACKLOG_2026_05.md.
--
-- Intentional design choice: do NOT fabricate timestamps for RESOLVED rows
-- where no EscalationEvent.resolvedAt exists. Those are the auto-resolve
-- victims (bug #6/#7) — the count of NULL resolvedAt on RESOLVED alerts is
-- itself audit evidence and must surface, not be papered over.

-- 1. resolvedAt — pull the latest EscalationEvent.resolvedAt per alert.
UPDATE "DeviationAlert" da
SET "resolvedAt" = sub.max_resolved_at
FROM (
  SELECT "alertId", MAX("resolvedAt") AS max_resolved_at
  FROM "EscalationEvent"
  WHERE "resolvedAt" IS NOT NULL
  GROUP BY "alertId"
) sub
WHERE da.id = sub."alertId"
  AND da.status = 'RESOLVED'
  AND da."resolvedAt" IS NULL;

-- 2. acknowledgedByUserId — pull the FIRST acknowledger per alert. Earliest
-- ack matches the moment the alert flipped state (subsequent acks on the
-- same alert via downstream EscalationEvent rows are noise).
UPDATE "DeviationAlert" da
SET "acknowledgedByUserId" = sub.first_ack_by
FROM (
  SELECT DISTINCT ON ("alertId")
    "alertId",
    "acknowledgedBy" AS first_ack_by
  FROM "EscalationEvent"
  WHERE "acknowledgedBy" IS NOT NULL
  ORDER BY "alertId", "acknowledgedAt" ASC
) sub
WHERE da.id = sub."alertId"
  AND da."acknowledgedAt" IS NOT NULL
  AND da."acknowledgedByUserId" IS NULL;

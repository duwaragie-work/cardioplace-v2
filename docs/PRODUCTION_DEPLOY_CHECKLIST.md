# Production Deploy Checklist

Tracks deploy-time tasks that need a human-in-the-loop or post-migration audit
read. Append a new section per deploy.

---

## Bug backlog 2026-05 — schema + ack propagation + auto-resolve removal

Three migrations + two code fixes shipping together (commits TBD on
`duwaragie-dev`). Each phase is independently revertable.

### Phase 1 — DeviationAlert audit-trail columns (commit `0ffae36`)

Adds 3 nullable / default-now columns: `acknowledgedByUserId`, `resolvedAt`,
`updatedAt`. Backfill migration populates the first two from `EscalationEvent`
rows where possible. Per spec, **does not fabricate timestamps for RESOLVED
rows where no EscalationEvent.resolvedAt exists** — those NULLs are audit
evidence of the bug-#6/#7 auto-resolve victims.

**Pre-deploy:** none. Migration is purely additive (`ADD COLUMN`).

**Post-deploy audit query (run once, capture the count for the CMO):**

```sql
-- How many RESOLVED alerts on prod were auto-resolved (no EscalationEvent
-- closure, no resolutionAction, no rationale)? This is the bug-#6/#7
-- production-side victim count.
SELECT COUNT(*) AS auto_resolve_victims
FROM "DeviationAlert" da
WHERE da.status = 'RESOLVED'
  AND NOT EXISTS (
    SELECT 1 FROM "EscalationEvent" ee
    WHERE ee."alertId" = da.id AND ee."resolvedAt" IS NOT NULL
  );

-- How many backfill recoveries succeeded? (resolvedAt now populated.)
SELECT COUNT(*) AS resolved_with_resolvedAt
FROM "DeviationAlert"
WHERE status = 'RESOLVED' AND "resolvedAt" IS NOT NULL;

-- How many ack-by-user IDs recovered from EscalationEvent?
SELECT COUNT(*) AS acked_with_user_id
FROM "DeviationAlert"
WHERE "acknowledgedAt" IS NOT NULL AND "acknowledgedByUserId" IS NOT NULL;
```

Capture each count and pass to the CMO + compliance lead.

### Phase 2 — Patient ack propagation (this commit)

`daily_journal.service.ts:398 acknowledgeAlert` now wraps both the
`DeviationAlert` update AND a matching `EscalationEvent.updateMany` in a
single transaction. Sets `acknowledgedByUserId = userId` on the alert row
and `acknowledgedAt + acknowledgedBy = userId` on every open EscalationEvent
row.

**Pre-deploy:** Phase 1 migration must be applied first (introduces
`acknowledgedByUserId` column referenced by this code).

**Post-deploy verification (manual smoke):**

1. Sign in as a test patient.
2. Submit a 165/100 reading → BP_LEVEL_1_HIGH alert fires.
3. As patient, ack the alert via `/notifications`.
4. As an admin, open the same alert's audit endpoint:
   `GET /api/admin/alerts/:id/audit`
5. Confirm: `acknowledgmentTimestamp` set, escalation timeline rows show
   `acknowledgedAt` + `acknowledgedBy = patient userId`.

### Phase 3 — Auto-resolve removal (TBD, §D)

Will land separately. Deletes `resolveOpenAlerts` + its call site. After this,
**only the explicit `POST /admin/alerts/:id/resolve` flow can transition an
alert to RESOLVED**. Re-document on next deploy.

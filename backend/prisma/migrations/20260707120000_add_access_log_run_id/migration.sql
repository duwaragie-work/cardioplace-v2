-- N2 (2026-07-07) — per-invocation correlation id on AccessLog.
--
-- Cron path: one runId per @Cron() fire, set by runAsCronActor.
-- HTTP path: one runId per request, set by the CLS interceptor.
--
-- Groups every AccessLog row emitted during the same run so the N7 exception-
-- report cron can compute per-run counts and detect anomalies at run
-- granularity (e.g. "cron X wrote 0 rows this run") rather than day
-- granularity. Nullable — pre-N2 rows genuinely have none.
--
-- Index supports the exception cron's runId GROUP BY pass and the audit
-- console's "show me every row in this run" drill-down.
ALTER TABLE "AccessLog" ADD COLUMN "runId" TEXT;
CREATE INDEX "AccessLog_runId_idx" ON "AccessLog"("runId");

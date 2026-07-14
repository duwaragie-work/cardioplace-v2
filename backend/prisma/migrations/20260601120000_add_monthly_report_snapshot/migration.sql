-- Phase/24 — MonthlyReportSnapshot cache table.
--
-- Stores immutable computed payloads for the Monthly Practice Analytics
-- Report (one row per practice × YYYY-MM). The cron fills it on the 1st
-- of each month; on-demand reads return the cached payload if present so
-- historical reports stay stable even when older alerts get retroactively
-- resolved.
--
-- Schema: see backend/prisma/schema/monthly_report_snapshot.prisma.
-- Wire format: see shared/src/monthly-report.ts (MonthlyReport).

CREATE TABLE "MonthlyReportSnapshot" (
    "id"          TEXT          NOT NULL,
    "practiceId"  TEXT          NOT NULL,
    "monthYear"   TEXT          NOT NULL,
    "generatedAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload"     JSONB         NOT NULL,

    CONSTRAINT "MonthlyReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- One snapshot per practice per month — cron upserts on this key.
CREATE UNIQUE INDEX "MonthlyReportSnapshot_practiceId_monthYear_key"
    ON "MonthlyReportSnapshot"("practiceId", "monthYear");

-- Listing recent snapshots for a practice (admin "history" view).
CREATE INDEX "MonthlyReportSnapshot_practiceId_generatedAt_idx"
    ON "MonthlyReportSnapshot"("practiceId", "generatedAt" DESC);

ALTER TABLE "MonthlyReportSnapshot"
    ADD CONSTRAINT "MonthlyReportSnapshot_practiceId_fkey"
    FOREIGN KEY ("practiceId") REFERENCES "Practice"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- N7 (2026-07-11) — automated audit exception-report tables.
--
-- HIPAA §164.308(a)(1)(ii)(D) Information System Activity Review — the daily
-- exception cron scans the past 24h of AccessLog / AuthLog /
-- EmailDisclosureLog + N1 audit-write-fail telemetry, runs 6 detectors, and
-- writes AuditException rows. Lakshitha's L3 UI reads these rows.
--
-- AuditException — one row per suspicious pattern. Idempotency key pins the
-- writer's upsert so a re-run of the cron in the same window UPDATES
-- (evidence + updatedAt), never inserts a duplicate.
--
-- AuditWriteFailureTally — producer-side counter for the DROPPED_AUDIT_WRITES
-- detector. writeAuditWithRetry.reportFailure upserts (kind, hourBucket) on
-- final failure. Detector scans buckets with count > 0.
--
-- No FK to User on the triage attribution columns (acknowledgedBy /
-- benignBy / escalatedToIncidentId) — those are Lakshitha's L3 ops user ids
-- and SecurityIncident id, both nullable until triaged.

-- ── New enum types ────────────────────────────────────────────────────────
CREATE TYPE "AuditExceptionDetectorId" AS ENUM (
    'BULK_PHI_READ',
    'OFF_HOURS_PHI_ACCESS',
    'CROSS_PRACTICE_ACCESS',
    'REPEATED_FAILED_AUTH',
    'DROPPED_AUDIT_WRITES',
    'UNATTRIBUTED_SYSTEM_DISCLOSURE'
);

CREATE TYPE "AuditExceptionSeverity" AS ENUM (
    'MEDIUM',
    'HIGH',
    'CRITICAL'
);

CREATE TYPE "AuditExceptionStatus" AS ENUM (
    'OPEN',
    'ACKNOWLEDGED',
    'RESOLVED',
    'FALSE_POSITIVE'
);

-- ── AuditException ────────────────────────────────────────────────────────
CREATE TABLE "AuditException" (
    "id" TEXT NOT NULL,
    "detectorId" "AuditExceptionDetectorId" NOT NULL,
    "severity" "AuditExceptionSeverity" NOT NULL,
    "status" "AuditExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "practiceContext" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "benignBy" TEXT,
    "benignAt" TIMESTAMP(3),
    "benignReason" TEXT,
    "escalatedToIncidentId" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditException_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditException_idempotencyKey_key"
    ON "AuditException"("idempotencyKey");

CREATE INDEX "AuditException_status_severity_createdAt_idx"
    ON "AuditException"("status", "severity", "createdAt");

CREATE INDEX "AuditException_detectorId_createdAt_idx"
    ON "AuditException"("detectorId", "createdAt");

CREATE INDEX "AuditException_practiceContext_status_createdAt_idx"
    ON "AuditException"("practiceContext", "status", "createdAt");

-- ── AuditWriteFailureTally ────────────────────────────────────────────────
CREATE TABLE "AuditWriteFailureTally" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "hourBucket" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditWriteFailureTally_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditWriteFailureTally_kind_hourBucket_key"
    ON "AuditWriteFailureTally"("kind", "hourBucket");

CREATE INDEX "AuditWriteFailureTally_hourBucket_idx"
    ON "AuditWriteFailureTally"("hourBucket");

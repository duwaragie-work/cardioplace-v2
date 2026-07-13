-- L3 (2026-07-12 — Lakshitha) — SecurityIncident tables.
--
-- HIPAA §164.308(a)(6) Security Incident Procedures. Created when a reviewer
-- ESCALATES an AuditException (N7) from the L3 worklist; the exception is then
-- marked RESOLVED with escalatedToIncidentId pinned to the new incident. The
-- incident then carries its own assign → work → resolve lifecycle with a
-- ticket-local action timeline (SecurityIncidentAction), mirroring the
-- SupportTicket / SupportTicketAction pair.
--
-- No FK to User on the ops-attribution columns and no FK to AuditException on
-- sourceExceptionId — same bare-id convention N7 uses, keeps this model free of
-- a build-time dependency on N7's schema.

-- ── New enum types ────────────────────────────────────────────────────────
CREATE TYPE "SecurityIncidentStatus" AS ENUM (
    'OPEN',
    'IN_PROGRESS',
    'RESOLVED'
);

CREATE TYPE "SecurityIncidentSeverity" AS ENUM (
    'MEDIUM',
    'HIGH',
    'CRITICAL'
);

CREATE TYPE "SecurityIncidentActionType" AS ENUM (
    'OPENED',
    'ASSIGNED',
    'NOTE_ADDED',
    'STATUS_CHANGED',
    'RESOLVED'
);

-- ── SecurityIncident ──────────────────────────────────────────────────────
CREATE TABLE "SecurityIncident" (
    "id" TEXT NOT NULL,
    "status" "SecurityIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "severity" "SecurityIncidentSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sourceExceptionId" TEXT,
    "sourceDetectorId" TEXT,
    "practiceContext" TEXT,
    "openedByOpsId" TEXT NOT NULL,
    "assignedToOpsId" TEXT,
    "resolutionNotes" TEXT,
    "resolvedByOpsId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityIncident_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SecurityIncident_status_severity_createdAt_idx"
    ON "SecurityIncident"("status", "severity", "createdAt");

CREATE INDEX "SecurityIncident_practiceContext_status_createdAt_idx"
    ON "SecurityIncident"("practiceContext", "status", "createdAt");

CREATE INDEX "SecurityIncident_assignedToOpsId_status_idx"
    ON "SecurityIncident"("assignedToOpsId", "status");

-- ── SecurityIncidentAction ────────────────────────────────────────────────
CREATE TABLE "SecurityIncidentAction" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "opsUserId" TEXT NOT NULL,
    "actionType" "SecurityIncidentActionType" NOT NULL,
    "metadata" JSONB,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityIncidentAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SecurityIncidentAction_incidentId_performedAt_idx"
    ON "SecurityIncidentAction"("incidentId", "performedAt");

ALTER TABLE "SecurityIncidentAction"
    ADD CONSTRAINT "SecurityIncidentAction_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "SecurityIncident"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

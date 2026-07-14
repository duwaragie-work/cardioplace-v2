-- Gap 5 — caregiver relationship + delivery (Niva).
--
-- Purely additive: one enum + two tables. No changes to existing columns, so
-- this is safe to apply on top of the Cluster 8 migration without backfill.
--
--   1. CaregiverNotifyChannel enum — NONE (pre-consent / opted out), DASHBOARD
--      (Option A account caregiver), SMS (Option B, no provider wired yet),
--      EMAIL (Option B, Resend EmailService — the pilot channel).
--
--   2. PatientCaregiver — a caregiver CONTACT attached to a patient (name +
--      email/phone), not necessarily a User. Dispatch of the signed-off
--      caregiverMessage is hard-gated on consentGivenAt (HIPAA). active=false
--      soft-disables instead of hard-deleting (audit of who could receive PHI).
--
--   3. CaregiverDispatchLog — idempotency for email/SMS channels, which write
--      no Notification row (the caregiver may not be a User). One row per
--      (alertId, caregiverId, channel) so a re-fired alert never double-sends.

-- ── 1. CaregiverNotifyChannel enum ──────────────────────────────────────────
CREATE TYPE "CaregiverNotifyChannel" AS ENUM ('NONE', 'DASHBOARD', 'SMS', 'EMAIL');

-- ── 2. PatientCaregiver ─────────────────────────────────────────────────────
CREATE TABLE "PatientCaregiver" (
    "id"              TEXT NOT NULL,
    "patientUserId"   TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "relationship"    TEXT,
    "phone"           TEXT,
    "email"           TEXT,
    "notifyChannel"   "CaregiverNotifyChannel" NOT NULL DEFAULT 'NONE',
    "consentGivenAt"  TIMESTAMP(3),
    "consentGivenBy"  TEXT,
    "caregiverUserId" TEXT,
    "active"          BOOLEAN NOT NULL DEFAULT true,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientCaregiver_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PatientCaregiver_patientUserId_idx" ON "PatientCaregiver"("patientUserId");

ALTER TABLE "PatientCaregiver"
ADD CONSTRAINT "PatientCaregiver_patientUserId_fkey"
FOREIGN KEY ("patientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 3. CaregiverDispatchLog ─────────────────────────────────────────────────
CREATE TABLE "CaregiverDispatchLog" (
    "id"          TEXT NOT NULL,
    "alertId"     TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "channel"     "CaregiverNotifyChannel" NOT NULL,
    "sentAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaregiverDispatchLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CaregiverDispatchLog_alertId_caregiverId_channel_key"
ON "CaregiverDispatchLog"("alertId", "caregiverId", "channel");

CREATE INDEX "CaregiverDispatchLog_caregiverId_idx" ON "CaregiverDispatchLog"("caregiverId");

ALTER TABLE "CaregiverDispatchLog"
ADD CONSTRAINT "CaregiverDispatchLog_alertId_fkey"
FOREIGN KEY ("alertId") REFERENCES "DeviationAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CaregiverDispatchLog"
ADD CONSTRAINT "CaregiverDispatchLog_caregiverId_fkey"
FOREIGN KEY ("caregiverId") REFERENCES "PatientCaregiver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

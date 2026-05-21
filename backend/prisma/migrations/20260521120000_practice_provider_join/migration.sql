-- May 2026 follow-up to the role-scope refactor. Adds the symmetric
-- PROVIDER ↔ Practice join (mirror of PracticeMedicalDirector). Before
-- this table, "practice staff" was derived implicitly from
-- PatientProviderAssignment — a provider only became a practice's staff
-- once a patient was assigned with them. Explicit join lets ops bootstrap
-- a practice with providers BEFORE the first patient assignment so the
-- care-team dropdown is populated on first use.
--
-- Backfill at the bottom: every distinct (practiceId, primaryProviderId)
-- and (practiceId, backupProviderId) pair from PatientProviderAssignment
-- becomes a membership row. ON CONFLICT guard handles the case where the
-- same provider is both primary and backup across different patients in
-- the same practice (rare but possible).

-- ── 1. PracticeProvider table ───────────────────────────────────────────────
CREATE TABLE "PracticeProvider" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeProvider_pkey" PRIMARY KEY ("id")
);

-- ── 2. Uniqueness + lookup indexes ──────────────────────────────────────────
CREATE UNIQUE INDEX "PracticeProvider_practiceId_userId_key"
    ON "PracticeProvider"("practiceId", "userId");

CREATE INDEX "PracticeProvider_practiceId_idx"
    ON "PracticeProvider"("practiceId");

CREATE INDEX "PracticeProvider_userId_idx"
    ON "PracticeProvider"("userId");

-- ── 3. Foreign keys ─────────────────────────────────────────────────────────
ALTER TABLE "PracticeProvider"
    ADD CONSTRAINT "PracticeProvider_practiceId_fkey"
    FOREIGN KEY ("practiceId") REFERENCES "Practice"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PracticeProvider"
    ADD CONSTRAINT "PracticeProvider_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 4. Backfill from existing assignments ───────────────────────────────────
-- Primary providers first.
INSERT INTO "PracticeProvider" ("id", "practiceId", "userId", "assignedAt")
SELECT DISTINCT
    gen_random_uuid()::text,
    "practiceId",
    "primaryProviderId",
    NOW()
FROM "PatientProviderAssignment"
ON CONFLICT ("practiceId", "userId") DO NOTHING;

-- Backup providers second (same target table, same ON CONFLICT — primary
-- + backup roles collapse to a single membership row per provider).
INSERT INTO "PracticeProvider" ("id", "practiceId", "userId", "assignedAt")
SELECT DISTINCT
    gen_random_uuid()::text,
    "practiceId",
    "backupProviderId",
    NOW()
FROM "PatientProviderAssignment"
ON CONFLICT ("practiceId", "userId") DO NOTHING;

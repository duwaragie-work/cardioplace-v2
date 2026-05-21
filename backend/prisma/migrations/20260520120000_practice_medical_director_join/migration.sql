-- May 2026 role-scope decision (see docs/ACCESS_SCOPE.md + docs/ADMIN_ROLE_ACCESS.md).
-- MED_DIR loses all-patient visibility and becomes scoped to their own
-- practice(s). Many-to-many because a MD can head multiple practices and a
-- practice can have multiple MDs.
--
-- Backfill at the bottom: every distinct (practiceId, medicalDirectorId)
-- pair from PatientProviderAssignment becomes a membership row so already-
-- assigned MDs aren't locked out on day 1.

-- ── 1. PracticeMedicalDirector table ────────────────────────────────────────
CREATE TABLE "PracticeMedicalDirector" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeMedicalDirector_pkey" PRIMARY KEY ("id")
);

-- ── 2. Uniqueness + lookup indexes ──────────────────────────────────────────
CREATE UNIQUE INDEX "PracticeMedicalDirector_practiceId_userId_key"
    ON "PracticeMedicalDirector"("practiceId", "userId");

CREATE INDEX "PracticeMedicalDirector_practiceId_idx"
    ON "PracticeMedicalDirector"("practiceId");

CREATE INDEX "PracticeMedicalDirector_userId_idx"
    ON "PracticeMedicalDirector"("userId");

-- ── 3. Foreign keys ─────────────────────────────────────────────────────────
ALTER TABLE "PracticeMedicalDirector"
    ADD CONSTRAINT "PracticeMedicalDirector_practiceId_fkey"
    FOREIGN KEY ("practiceId") REFERENCES "Practice"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PracticeMedicalDirector"
    ADD CONSTRAINT "PracticeMedicalDirector_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 4. Backfill from existing assignments ───────────────────────────────────
-- gen_random_uuid() is PG13+ built-in. ON CONFLICT guards against the
-- (rare but possible) case where multiple patients share the same
-- (practice, MD) pair — only one membership row per pair.
INSERT INTO "PracticeMedicalDirector" ("id", "practiceId", "userId", "assignedAt")
SELECT DISTINCT
    gen_random_uuid()::text,
    "practiceId",
    "medicalDirectorId",
    NOW()
FROM "PatientProviderAssignment"
ON CONFLICT ("practiceId", "userId") DO NOTHING;

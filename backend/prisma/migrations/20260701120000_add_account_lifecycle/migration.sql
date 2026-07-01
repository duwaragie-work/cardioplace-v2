-- Account lifecycle (phase/28) — deactivate / reactivate / permanent-close.
--   * User gains the session kill-switch (tokenVersion) + tombstone audit
--     fields + a restore snapshot. All additive, all nullable except the
--     defaulted tokenVersion, so existing rows are untouched.
--   * AccountStatus gains CLOSED (irreversible tombstoned state).
--   * AccountClosureLog — append-only lifecycle audit trail.

-- ── 1. AccountStatus enum — add CLOSED ──────────────────────────────────────
-- ADD VALUE is fine on the managed Prisma Postgres (16.x); IF NOT EXISTS makes
-- the migration idempotent on re-run.
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'CLOSED';

-- ── 2. User lifecycle columns ───────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "tombstonedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "tombstonedById" TEXT;
ALTER TABLE "User" ADD COLUMN "closureReason" TEXT;
ALTER TABLE "User" ADD COLUMN "terminationSnapshot" JSONB;

-- ── 3. AccountClosureLog (append-only audit) ────────────────────────────────
CREATE TABLE "AccountClosureLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "displayId" TEXT,
    "action" TEXT NOT NULL,
    "performedById" TEXT,
    "performedByRole" TEXT,
    "selfService" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "snapshot" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountClosureLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccountClosureLog_userId_idx" ON "AccountClosureLog"("userId");
CREATE INDEX "AccountClosureLog_action_idx" ON "AccountClosureLog"("action");
CREATE INDEX "AccountClosureLog_createdAt_idx" ON "AccountClosureLog"("createdAt");

ALTER TABLE "AccountClosureLog"
    ADD CONSTRAINT "AccountClosureLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

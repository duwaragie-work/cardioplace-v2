-- Support lifecycle states + timestamps + ops-queue action types.
--
-- Hand-authored and applied via `prisma migrate deploy` (NOT `migrate dev`):
-- the dev DB carries a benign drift — the HNSW vector index that
-- prisma.service.ts creates imperatively at boot (`CREATE INDEX IF NOT EXISTS
-- "hnsw_index" ... USING hnsw`) — which lives outside migration history.
-- `migrate dev` reacts to that drift by offering to RESET the shared dev DB;
-- `migrate deploy` applies forward-only and leaves shared data untouched.
-- All statements below are additive and idempotent.

-- New lifecycle states (match prior-migration idiom: ADD VALUE IF NOT EXISTS).
ALTER TYPE "SupportStatus" ADD VALUE IF NOT EXISTS 'AWAITING_REPLY';
ALTER TYPE "SupportStatus" ADD VALUE IF NOT EXISTS 'REOPENED';
ALTER TYPE "SupportStatus" ADD VALUE IF NOT EXISTS 'CLOSED';

-- Ops-queue action types (assignment + priority change — both opsUserId-stamped).
ALTER TYPE "SupportActionType" ADD VALUE IF NOT EXISTS 'ASSIGNED';
ALTER TYPE "SupportActionType" ADD VALUE IF NOT EXISTS 'PRIORITY_CHANGED';

-- Lifecycle timestamps. updatedAt gets a DB default so existing rows are valid
-- and the schema's @default(now()) matches (no future drift); the app's
-- @updatedAt manages it thereafter. closedAt/reopenedAt are nullable events.
ALTER TABLE "SupportTicket" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SupportTicket" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "SupportTicket" ADD COLUMN "reopenedAt" TIMESTAMP(3);

-- Auto-close sweep scans RESOLVED tickets by resolvedAt.
CREATE INDEX IF NOT EXISTS "SupportTicket_status_resolvedAt_idx" ON "SupportTicket"("status", "resolvedAt");

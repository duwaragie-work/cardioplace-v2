-- Narrow SupportStatus to the agreed four-state lifecycle (Duwaragie, 2026-07-21):
--   OPEN | IN_PROGRESS | RESOLVED | CLOSED
--
-- 20260720120000 had added AWAITING_REPLY and REOPENED. Both are dropped here:
-- "awaiting reply" is now DERIVED from the last reply's authorType rather than
-- stored (a stored copy was functionally identical and could drift from the
-- thread), and a reopen returns the ticket to IN_PROGRESS with `reopenedAt`
-- recording the event instead of occupying its own state.
--
-- Postgres cannot DROP a value from an enum, so the type is recreated. Rows in a
-- dropped state are remapped to IN_PROGRESS first — both meant "active, needs
-- work", so IN_PROGRESS is the faithful landing spot and no ticket is lost.
--
-- Hand-authored and applied via `prisma migrate deploy` (NOT `migrate dev`):
-- the dev DB carries a benign drift — the HNSW vector index prisma.service.ts
-- creates at boot — and `migrate dev` reacts to it by offering to RESET the
-- shared dev DB. `migrate deploy` applies forward-only and leaves data intact.

-- 1. Remap any row sitting in a state that is about to disappear.
UPDATE "SupportTicket" SET "status" = 'IN_PROGRESS'
WHERE "status" IN ('AWAITING_REPLY', 'REOPENED');

-- 2. Recreate the type with only the four agreed values.
ALTER TYPE "SupportStatus" RENAME TO "SupportStatus_old";

CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- The default has to come off before the column type can be swapped, then go back.
ALTER TABLE "SupportTicket" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "SupportTicket"
  ALTER COLUMN "status" TYPE "SupportStatus"
  USING "status"::text::"SupportStatus";

ALTER TABLE "SupportTicket" ALTER COLUMN "status" SET DEFAULT 'OPEN';

DROP TYPE "SupportStatus_old";

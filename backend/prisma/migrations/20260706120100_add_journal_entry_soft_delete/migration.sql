-- Soft-delete for JournalEntry (HIPAA L5, Duwaragie sign-off 2026-07-06).
-- A deleted BP reading is stamped with `deletedAt` instead of being hard-
-- deleted, so its fired DeviationAlert + escalations + notifications survive
-- (the FK onDelete: Cascade never fires). A Prisma client extension filters
-- `deletedAt IS NULL` into all top-level JournalEntry reads.

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "JournalEntry_deletedAt_idx" ON "JournalEntry"("deletedAt");

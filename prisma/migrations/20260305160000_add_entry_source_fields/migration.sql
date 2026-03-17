-- CreateEnum
CREATE TYPE "EntrySource" AS ENUM ('MANUAL', 'HEALTHKIT');

-- AlterTable: add source (default MANUAL) and sourceMetadata
ALTER TABLE "JournalEntry" ADD COLUMN "source" "EntrySource" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "JournalEntry" ADD COLUMN "sourceMetadata" JSONB;

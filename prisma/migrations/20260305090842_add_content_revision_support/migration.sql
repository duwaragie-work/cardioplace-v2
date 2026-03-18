-- CreateEnum
CREATE TYPE "ContentRevisionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PARTIALLY_APPROVED');

-- DropIndex
DROP INDEX "hnsw_index";

-- AlterTable
ALTER TABLE "Content" ADD COLUMN     "publishedVersionNo" INTEGER,
ADD COLUMN     "revisionStatus" "ContentRevisionStatus";

-- AlterTable
ALTER TABLE "ContentVersion" ADD COLUMN     "isDraft" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "ContentVersion_isDraft_idx" ON "ContentVersion"("isDraft");

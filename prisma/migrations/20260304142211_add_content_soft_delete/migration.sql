-- AlterTable
ALTER TABLE "Content" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Content_deletedAt_idx" ON "Content"("deletedAt");

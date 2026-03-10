/*
  Warnings:

  - A unique constraint covering the columns `[humanId]` on the table `Content` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `humanId` to the `Content` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Content" ADD COLUMN     "humanId" TEXT NOT NULL,
ADD COLUMN     "reviewVersionNo" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Content_humanId_key" ON "Content"("humanId");

/*
  Warnings:

  - You are about to drop the column `message` on the `EmergencyEvent` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "EmergencyEvent" DROP COLUMN "message",
ADD COLUMN     "emergency_situation" TEXT;

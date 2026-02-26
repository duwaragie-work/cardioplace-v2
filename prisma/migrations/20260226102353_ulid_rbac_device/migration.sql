/*
  Warnings:

  - You are about to drop the column `attempts` on the `OtpCode` table. All the data in the column will be lost.
  - You are about to drop the column `consumedAt` on the `OtpCode` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('GUEST', 'REGISTERED_USER', 'VERIFIED_USER', 'CONTENT_ADMIN', 'ARTICLE_ADMIN', 'ARTICLE_APPROVER', 'KB_UPLOADER', 'KB_APPROVER', 'CHAT_REVIEWER', 'SUPER_ADMIN');

-- AlterTable
ALTER TABLE "OtpCode" DROP COLUMN "attempts",
DROP COLUMN "consumedAt",
ADD COLUMN     "isConsumed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isFailedAttempt" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "age" INTEGER,
ADD COLUMN     "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'GUEST';

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "platform" TEXT,
    "deviceType" TEXT,
    "deviceName" TEXT,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_deviceId_key" ON "Device"("deviceId");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

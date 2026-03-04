/*
  Warnings:

  - You are about to drop the column `onboardingCompleted` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `primarySymptoms` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `primarySymptomsOtherText` on the `User` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_COMPLETED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'SUSPENDED');

-- AlterTable
ALTER TABLE "User" DROP COLUMN "onboardingCompleted",
DROP COLUMN "primarySymptoms",
DROP COLUMN "primarySymptomsOtherText",
ADD COLUMN     "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'NOT_COMPLETED';

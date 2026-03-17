-- CreateEnum
CREATE TYPE "Mood" AS ENUM ('CALM', 'ANXIOUS', 'DEPRESSED', 'IRRITABLE', 'ENERGIZED', 'NEUTRAL');

-- AlterTable: make sleep metrics nullable
ALTER TABLE "JournalEntry" ALTER COLUMN "sleepHours" DROP NOT NULL;
ALTER TABLE "JournalEntry" ALTER COLUMN "sleepQuality" DROP NOT NULL;
ALTER TABLE "JournalEntry" ALTER COLUMN "awakenings" DROP NOT NULL;

-- AlterTable: add new columns
ALTER TABLE "JournalEntry" ADD COLUMN "bedtime" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN "wakeTime" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN "symptoms" JSONB;
ALTER TABLE "JournalEntry" ADD COLUMN "mood" "Mood";

-- AlterTable: change notes to VARCHAR(500)
ALTER TABLE "JournalEntry" ALTER COLUMN "notes" TYPE VARCHAR(500);

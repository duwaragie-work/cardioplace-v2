-- AlterTable: add measurementTime column
ALTER TABLE "JournalEntry" ADD COLUMN "measurementTime" TEXT;

-- DropIndex: old unique constraint
DROP INDEX "JournalEntry_userId_entryDate_key";

-- CreateIndex: new unique constraint including measurementTime
CREATE UNIQUE INDEX "JournalEntry_userId_entryDate_measurementTime_key" ON "JournalEntry"("userId", "entryDate", "measurementTime");

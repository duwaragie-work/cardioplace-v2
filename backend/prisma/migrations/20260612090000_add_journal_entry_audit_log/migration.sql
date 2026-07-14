-- Journal-entry audit log (HIPAA/JCAHO closure) + admin-entered readings.

-- 1. Add 6 new VerificationChangeType enum values for journal-entry audit
ALTER TYPE "VerificationChangeType" ADD VALUE 'PATIENT_READING_CREATED';
ALTER TYPE "VerificationChangeType" ADD VALUE 'PATIENT_READING_EDITED';
ALTER TYPE "VerificationChangeType" ADD VALUE 'PATIENT_READING_DELETED';
ALTER TYPE "VerificationChangeType" ADD VALUE 'ADMIN_READING_ADDED';
ALTER TYPE "VerificationChangeType" ADD VALUE 'ADMIN_READING_EDITED';
ALTER TYPE "VerificationChangeType" ADD VALUE 'ADMIN_READING_DELETED';

-- 2. Admin-entered readings carry source = ADMIN (pairs with addedByUserId)
ALTER TYPE "EntrySource" ADD VALUE 'ADMIN';

-- 3. Add addedByUserId on JournalEntry (set on admin-added rows; null for patient-entered)
ALTER TABLE "JournalEntry" ADD COLUMN "addedByUserId" TEXT;
ALTER TABLE "JournalEntry"
  ADD CONSTRAINT "JournalEntry_addedByUserId_fkey"
  FOREIGN KEY ("addedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "JournalEntry_addedByUserId_idx" ON "JournalEntry"("addedByUserId");

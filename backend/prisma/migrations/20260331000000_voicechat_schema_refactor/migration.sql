-- Voice chat schema refactor: rolling summary stored in Session, Conversation simplified

-- Conversation: rename aiResponse -> aiSummary
ALTER TABLE "Conversation" RENAME COLUMN "aiResponse" TO "aiSummary";

-- Conversation: add source column (non-nullable with default)
ALTER TABLE "Conversation" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'text';

-- Conversation: drop legacy menopause config columns
ALTER TABLE "Conversation" DROP COLUMN IF EXISTS "medicalLens";
ALTER TABLE "Conversation" DROP COLUMN IF EXISTS "tone";
ALTER TABLE "Conversation" DROP COLUMN IF EXISTS "detailLevel";
ALTER TABLE "Conversation" DROP COLUMN IF EXISTS "careApproach";
ALTER TABLE "Conversation" DROP COLUMN IF EXISTS "spirituality";

-- Session: add rolling summary fields
ALTER TABLE "Session" ADD COLUMN "summary" TEXT;
ALTER TABLE "Session" ADD COLUMN "messageCount" INTEGER NOT NULL DEFAULT 0;

-- Revert vector columns back to 384 dimensions (xenova/transformers all-MiniLM-L6-v2)
UPDATE "Conversation" SET "embedding" = NULL WHERE "embedding" IS NOT NULL;
UPDATE "DocumentVector" SET "embedding" = NULL WHERE "embedding" IS NOT NULL;

ALTER TABLE "Conversation" ALTER COLUMN "embedding" TYPE vector(384);
ALTER TABLE "DocumentVector" ALTER COLUMN "embedding" TYPE vector(384);

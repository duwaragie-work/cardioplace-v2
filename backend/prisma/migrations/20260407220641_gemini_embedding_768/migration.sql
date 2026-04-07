-- Clear old 384-dim embeddings (incompatible with new Gemini text-embedding-004 model)
UPDATE "Conversation" SET "embedding" = NULL WHERE "embedding" IS NOT NULL;
UPDATE "DocumentVector" SET "embedding" = NULL WHERE "embedding" IS NOT NULL;

-- Resize vector columns from 384 to 768 dimensions (Gemini text-embedding-004)
ALTER TABLE "Conversation" ALTER COLUMN "embedding" TYPE vector(768);
ALTER TABLE "DocumentVector" ALTER COLUMN "embedding" TYPE vector(768);

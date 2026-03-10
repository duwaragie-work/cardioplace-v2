-- Baseline: the hnsw_index on DocumentVector already exists in the database
-- (created during pgvector setup). This migration records it in history
-- so Prisma migrate dev can proceed without a reset.
CREATE INDEX IF NOT EXISTS "hnsw_index" ON "DocumentVector" USING hnsw (embedding vector_cosine_ops);

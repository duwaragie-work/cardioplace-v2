-- Ensure pgvector extension + HNSW index exist on DocumentVector.
-- Some earlier migrations dropped the index, so this migration recreates it
-- without removing any existing data.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE INDEX IF NOT EXISTS "hnsw_index"
ON "DocumentVector"
USING hnsw ("embedding" vector_cosine_ops);


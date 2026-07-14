-- Full-text search over chunk content for the hybrid (keyword) search arm.
CREATE INDEX IF NOT EXISTS "chunks_content_fts_idx"
  ON "chunks" USING GIN (to_tsvector('english', "content"));

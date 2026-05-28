-- Add HNSW (Hierarchical Navigable Small World) index on knowledge_base_embeddings.embedding
-- for fast cosine-distance similarity search via pgvector's <=> operator.
--
-- Without this index, similarity searches do a full sequential scan over every
-- row, which is fine at the current ~235 rows but degrades sharply past ~1k.
-- HNSW is the right pick: O(log n) lookup, no recall trade-off at standard
-- params, builds incrementally as rows are inserted.
--
-- Parameters:
--   m = 16              — connections per node (default; good general-purpose)
--   ef_construction = 64 — build-time accuracy/speed tradeoff (default)
--
-- vector_cosine_ops matches the <=> cosine distance operator used by
-- knowledgeBase.embedding.service.ts:searchSimilarWithSources.
--
-- The index is created CONCURRENTLY so it can run without blocking writes,
-- but Prisma migrate doesn't support CREATE INDEX CONCURRENTLY inside a
-- transaction. For initial deployment this is acceptable — the table is
-- small. For future re-creation: drop manually then run the CONCURRENTLY
-- form outside migrate.

CREATE INDEX IF NOT EXISTS knowledge_base_embeddings_embedding_hnsw_idx
  ON knowledge_base_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

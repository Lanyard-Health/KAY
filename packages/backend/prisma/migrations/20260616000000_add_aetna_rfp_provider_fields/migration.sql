-- Aetna RFP adapter provider fields (Phase 2 data wiring).
-- Pure additive: three columns on "providers", all with defaults — no table
-- rewrite, no NOT NULL-without-default, no data backfill.
--
-- NOTE: `prisma migrate diff` also emits a spurious `DROP INDEX
-- knowledge_base_embeddings_embedding_hnsw_idx` because Prisma's schema cannot
-- model the pgvector HNSW index created in 20260528110813. That drop is
-- intentionally OMITTED here — the index must stay.
ALTER TABLE "providers"
  ADD COLUMN "hospitalist"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "practice_focus" TEXT[]           DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "age_group"      TEXT[]           DEFAULT ARRAY[]::TEXT[];

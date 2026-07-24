-- Make providers.email optional: staff-created providers (added via NPI
-- registry lookup) may have no email until entered manually — NPPES doesn't
-- publish email and CAQH sync doesn't backfill it. Pure DROP NOT NULL, no
-- data rewrite.
--
-- NOTE: `prisma migrate diff` also emits a spurious `DROP INDEX
-- knowledge_base_embeddings_embedding_hnsw_idx` because Prisma's schema cannot
-- model the pgvector HNSW index created in 20260528110813. That drop is
-- intentionally OMITTED here — the index must stay.
ALTER TABLE "providers" ALTER COLUMN "email" DROP NOT NULL;

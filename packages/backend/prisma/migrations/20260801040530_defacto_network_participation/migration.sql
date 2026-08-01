-- NOTE: `prisma migrate diff` emits a spurious `DROP INDEX
-- knowledge_base_embeddings_embedding_hnsw_idx` (pgvector HNSW index not
-- representable in schema.prisma). Intentionally OMITTED — the index must stay.

-- CreateEnum
CREATE TYPE "DefactoSnapshotStatus" AS ENUM ('found', 'not_found', 'error');

-- CreateTable
CREATE TABLE "defacto_snapshots" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "npi" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "DefactoSnapshotStatus" NOT NULL,
    "raw_response" JSONB,
    "error_message" TEXT,

    CONSTRAINT "defacto_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "defacto_plan_records" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "carrier_name" TEXT,
    "carrier_or_plan_name" TEXT NOT NULL,
    "lob" TEXT,
    "organization_name" TEXT,
    "organization_npi" TEXT,
    "location_city" TEXT,
    "location_state" TEXT,

    CONSTRAINT "defacto_plan_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "defacto_snapshots_provider_id_fetched_at_idx" ON "defacto_snapshots"("provider_id", "fetched_at");

-- CreateIndex
CREATE INDEX "defacto_plan_records_snapshot_id_idx" ON "defacto_plan_records"("snapshot_id");

-- CreateIndex
CREATE INDEX "defacto_plan_records_location_state_idx" ON "defacto_plan_records"("location_state");

-- AddForeignKey
ALTER TABLE "defacto_snapshots" ADD CONSTRAINT "defacto_snapshots_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defacto_plan_records" ADD CONSTRAINT "defacto_plan_records_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "defacto_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

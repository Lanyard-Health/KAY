-- NOTE: `prisma migrate diff` emits a spurious `DROP INDEX
-- knowledge_base_embeddings_embedding_hnsw_idx` (pgvector HNSW index not
-- representable in schema.prisma). Intentionally OMITTED — the index must stay.

-- CreateEnum
CREATE TYPE "CaqhCredentialRequestStatus" AS ENUM ('pending', 'completed', 'revoked', 'expired');

-- AlterEnum: staff in-app notification when a provider submits corrected CAQH credentials
ALTER TYPE "InAppNotificationType" ADD VALUE 'caqh_credentials_updated';

-- CreateTable
CREATE TABLE "caqh_credential_requests" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "CaqhCredentialRequestStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "requested_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "caqh_credential_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "caqh_credential_requests_token_hash_key" ON "caqh_credential_requests"("token_hash");

-- CreateIndex
CREATE INDEX "caqh_credential_requests_provider_id_idx" ON "caqh_credential_requests"("provider_id");

-- AddForeignKey
ALTER TABLE "caqh_credential_requests" ADD CONSTRAINT "caqh_credential_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caqh_credential_requests" ADD CONSTRAINT "caqh_credential_requests_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

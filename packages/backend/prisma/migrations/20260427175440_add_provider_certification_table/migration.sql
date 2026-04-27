-- CreateEnum
CREATE TYPE "ProviderCertificationType" AS ENUM ('acls', 'bls', 'cpr', 'pals', 'other');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "linked_provider_certification_id" TEXT;

-- CreateTable
CREATE TABLE "provider_certifications" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "cert_type" "ProviderCertificationType" NOT NULL,
    "cert_description" TEXT NOT NULL,
    "cert_number" TEXT,
    "caqh_certification_id" TEXT,
    "issuing_authority" TEXT,
    "issue_date" TIMESTAMP(3),
    "expiration_date" TIMESTAMP(3),
    "status" "CredentialStatus" NOT NULL DEFAULT 'active',
    "source" "CredentialSource" NOT NULL DEFAULT 'manual_entry',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "provider_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_certifications_provider_id_idx" ON "provider_certifications"("provider_id");

-- CreateIndex
CREATE INDEX "provider_certifications_expiration_date_idx" ON "provider_certifications"("expiration_date");

-- CreateIndex
CREATE INDEX "provider_certifications_provider_id_caqh_certification_id_idx" ON "provider_certifications"("provider_id", "caqh_certification_id");

-- AddForeignKey
ALTER TABLE "provider_certifications" ADD CONSTRAINT "provider_certifications_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_certifications" ADD CONSTRAINT "provider_certifications_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_certifications" ADD CONSTRAINT "provider_certifications_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_linked_provider_certification_id_fkey" FOREIGN KEY ("linked_provider_certification_id") REFERENCES "provider_certifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

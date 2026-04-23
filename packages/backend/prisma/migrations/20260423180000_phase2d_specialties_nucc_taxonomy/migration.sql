-- Phase 2d: add NUCC taxonomy to Specialty + link-table metadata on ProviderSpecialty

-- AlterTable: Specialty gains nucc_taxonomy_code (nullable, unique)
ALTER TABLE "specialties" ADD COLUMN "nucc_taxonomy_code" TEXT;

-- CreateIndex: enforce uniqueness of NUCC codes
CREATE UNIQUE INDEX "specialties_nucc_taxonomy_code_key" ON "specialties"("nucc_taxonomy_code");

-- AlterTable: ProviderSpecialty gains is_primary, nucc_taxonomy_code, caqh_specialty_id, source, updated_at
ALTER TABLE "provider_specialties" ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "provider_specialties" ADD COLUMN "nucc_taxonomy_code" TEXT;
ALTER TABLE "provider_specialties" ADD COLUMN "caqh_specialty_id" TEXT;
ALTER TABLE "provider_specialties" ADD COLUMN "source" "CredentialSource" NOT NULL DEFAULT 'manual_entry';
ALTER TABLE "provider_specialties" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex: dedupe lookup by (providerId, caqhSpecialtyId)
CREATE INDEX "provider_specialties_provider_id_caqh_specialty_id_idx" ON "provider_specialties"("provider_id", "caqh_specialty_id");

-- CreateEnum
CREATE TYPE "MedicareStatus" AS ENUM ('ENROLLED', 'NOT_ENROLLED', 'UNVERIFIED');

-- CreateTable
CREATE TABLE "medicare_verifications" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "status" "MedicareStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verified_at" TIMESTAMP(3),
    "npi" TEXT,
    "pac_id" TEXT,
    "enrollment_count" INTEGER NOT NULL DEFAULT 0,
    "enrollment_states" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "raw_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicare_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "medicare_verifications_provider_id_key" ON "medicare_verifications"("provider_id");

-- CreateIndex
CREATE INDEX "medicare_verifications_status_idx" ON "medicare_verifications"("status");

-- CreateIndex
CREATE INDEX "medicare_verifications_verified_at_idx" ON "medicare_verifications"("verified_at");

-- AddForeignKey
ALTER TABLE "medicare_verifications" ADD CONSTRAINT "medicare_verifications_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

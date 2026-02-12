-- CreateEnum
CREATE TYPE "DirectoryListingStatus" AS ENUM ('listed', 'not_found', 'mismatch', 'error');

-- CreateTable
CREATE TABLE "provider_directory_snapshots" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "payer_id" TEXT NOT NULL,
    "status" "DirectoryListingStatus" NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fhir_response" JSONB,
    "listed_name" TEXT,
    "listed_npi" TEXT,
    "listed_phone" TEXT,
    "listed_specialty" TEXT,
    "listed_address" TEXT,
    "network_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mismatches" JSONB,

    CONSTRAINT "provider_directory_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_directory_alerts" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "payer_id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_directory_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_directory_snapshots_provider_id_payer_id_idx" ON "provider_directory_snapshots"("provider_id", "payer_id");

-- CreateIndex
CREATE INDEX "provider_directory_snapshots_checked_at_idx" ON "provider_directory_snapshots"("checked_at");

-- CreateIndex
CREATE INDEX "provider_directory_alerts_provider_id_idx" ON "provider_directory_alerts"("provider_id");

-- CreateIndex
CREATE INDEX "provider_directory_alerts_resolved_idx" ON "provider_directory_alerts"("resolved");

-- AddForeignKey
ALTER TABLE "provider_directory_snapshots" ADD CONSTRAINT "provider_directory_snapshots_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_directory_snapshots" ADD CONSTRAINT "provider_directory_snapshots_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_directory_alerts" ADD CONSTRAINT "provider_directory_alerts_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_directory_alerts" ADD CONSTRAINT "provider_directory_alerts_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_directory_alerts" ADD CONSTRAINT "provider_directory_alerts_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "provider_directory_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

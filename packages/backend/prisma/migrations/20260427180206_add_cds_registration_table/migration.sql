-- CreateTable
CREATE TABLE "cds_registrations" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "cds_number_encrypted" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "issue_date" TIMESTAMP(3),
    "expiration_date" TIMESTAMP(3),
    "status" "CredentialStatus" NOT NULL DEFAULT 'active',
    "source" "CredentialSource" NOT NULL DEFAULT 'manual_entry',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "cds_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cds_registrations_provider_id_idx" ON "cds_registrations"("provider_id");

-- CreateIndex
CREATE INDEX "cds_registrations_state_idx" ON "cds_registrations"("state");

-- CreateIndex
CREATE UNIQUE INDEX "cds_registrations_provider_id_state_key" ON "cds_registrations"("provider_id", "state");

-- AddForeignKey
ALTER TABLE "cds_registrations" ADD CONSTRAINT "cds_registrations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cds_registrations" ADD CONSTRAINT "cds_registrations_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cds_registrations" ADD CONSTRAINT "cds_registrations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

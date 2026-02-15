/*
  Warnings:

  - A unique constraint covering the columns `[caqh_provider_id]` on the table `providers` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "caqh_sync_logs" ADD COLUMN     "duration_ms" INTEGER,
ADD COLUMN     "retry_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "educations" ADD COLUMN     "source" "CredentialSource" NOT NULL DEFAULT 'manual_entry';

-- CreateIndex
CREATE UNIQUE INDEX "providers_caqh_provider_id_key" ON "providers"("caqh_provider_id");

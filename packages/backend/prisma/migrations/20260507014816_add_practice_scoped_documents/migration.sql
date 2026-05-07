-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "practice_id" TEXT,
ALTER COLUMN "provider_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "documents_practice_id_idx" ON "documents"("practice_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce XOR ownership: a Document is either provider-scoped or practice-scoped, never both, never neither.
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_owner_xor_check"
  CHECK (
    (provider_id IS NOT NULL AND practice_id IS NULL)
    OR
    (provider_id IS NULL AND practice_id IS NOT NULL)
  );

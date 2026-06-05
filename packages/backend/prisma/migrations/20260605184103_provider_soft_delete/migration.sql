-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "deleted_by" TEXT,
ADD COLUMN     "deletion_reason" TEXT;

-- CreateIndex
CREATE INDEX "providers_practice_id_deleted_at_idx" ON "providers"("practice_id", "deleted_at");

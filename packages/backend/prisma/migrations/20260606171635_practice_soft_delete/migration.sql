-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PRACTICE_SOFT_DELETE';
ALTER TYPE "AuditAction" ADD VALUE 'PRACTICE_RESTORE';

-- AlterTable
ALTER TABLE "practices" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "deleted_by" TEXT,
ADD COLUMN     "deletion_reason" TEXT;

-- CreateIndex
CREATE INDEX "practices_deleted_at_idx" ON "practices"("deleted_at");

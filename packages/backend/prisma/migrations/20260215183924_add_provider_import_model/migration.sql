-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('pending', 'validating', 'completed', 'failed');

-- CreateTable
CREATE TABLE "provider_imports" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'pending',
    "total_rows" INTEGER NOT NULL,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "error_details" JSONB,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "provider_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_imports_practice_id_idx" ON "provider_imports"("practice_id");

-- AddForeignKey
ALTER TABLE "provider_imports" ADD CONSTRAINT "provider_imports_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

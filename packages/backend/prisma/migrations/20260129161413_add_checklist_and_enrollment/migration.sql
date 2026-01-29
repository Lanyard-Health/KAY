-- CreateEnum
CREATE TYPE "ChecklistItemStatus" AS ENUM ('not_started', 'pending_upload', 'pending_review', 'approved', 'rejected');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'w9';
ALTER TYPE "DocumentType" ADD VALUE 'coi';
ALTER TYPE "DocumentType" ADD VALUE 'cp575';

-- CreateTable
CREATE TABLE "provider_checklists" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "w9_status" "ChecklistItemStatus" NOT NULL DEFAULT 'not_started',
    "w9_document_id" TEXT,
    "w9_reviewed_at" TIMESTAMP(3),
    "w9_reviewed_by" TEXT,
    "w9_notes" TEXT,
    "coi_status" "ChecklistItemStatus" NOT NULL DEFAULT 'not_started',
    "coi_document_id" TEXT,
    "coi_reviewed_at" TIMESTAMP(3),
    "coi_reviewed_by" TEXT,
    "coi_notes" TEXT,
    "cp575_status" "ChecklistItemStatus" NOT NULL DEFAULT 'not_started',
    "cp575_document_id" TEXT,
    "cp575_reviewed_at" TIMESTAMP(3),
    "cp575_reviewed_by" TEXT,
    "cp575_notes" TEXT,
    "license_verified" BOOLEAN NOT NULL DEFAULT false,
    "credentials_complete" BOOLEAN NOT NULL DEFAULT false,
    "background_check_complete" BOOLEAN NOT NULL DEFAULT false,
    "overall_complete" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_checklists_provider_id_key" ON "provider_checklists"("provider_id");

-- AddForeignKey
ALTER TABLE "provider_checklists" ADD CONSTRAINT "provider_checklists_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

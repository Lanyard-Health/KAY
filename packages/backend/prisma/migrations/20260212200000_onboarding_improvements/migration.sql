-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "review_notes" TEXT,
ADD COLUMN     "review_status" TEXT DEFAULT 'pending',
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by_id" TEXT,
ADD COLUMN     "uploaded_via_portal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "provider_applications" ADD COLUMN     "previous_application_id" TEXT;

-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "onboarding_completed_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "provider_applications_previous_application_id_key" ON "provider_applications"("previous_application_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_applications" ADD CONSTRAINT "provider_applications_previous_application_id_fkey" FOREIGN KEY ("previous_application_id") REFERENCES "provider_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

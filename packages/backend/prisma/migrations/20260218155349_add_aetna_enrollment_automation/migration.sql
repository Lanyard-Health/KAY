-- CreateEnum
CREATE TYPE "AetnaRunStatus" AS ENUM ('pending', 'filling', 'awaiting_review', 'submitting', 'completed', 'failed', 'rejected', 'timed_out');

-- AlterTable
ALTER TABLE "hospital_affiliations" ADD COLUMN     "facility_address_line1" TEXT,
ADD COLUMN     "facility_city" TEXT,
ADD COLUMN     "facility_npi" TEXT,
ADD COLUMN     "facility_phone" TEXT,
ADD COLUMN     "facility_state" TEXT,
ADD COLUMN     "facility_zip_code" TEXT;

-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "accepting_medicaid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "accepting_medicare" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "e_prescribing" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "aetna_enrollment_runs" (
    "id" TEXT NOT NULL,
    "payer_enrollment_id" TEXT NOT NULL,
    "status" "AetnaRunStatus" NOT NULL DEFAULT 'pending',
    "aetna_request_id" TEXT,
    "form_payload" JSONB NOT NULL,
    "automation_log" TEXT,
    "error_message" TEXT,
    "error_page" INTEGER,
    "screenshot_doc_ids" TEXT[],
    "confirmation_pdf_id" TEXT,
    "started_at" TIMESTAMP(3),
    "review_expires_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "initiated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aetna_enrollment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "providers_status_idx" ON "providers"("status");

-- CreateIndex
CREATE INDEX "providers_practice_id_idx" ON "providers"("practice_id");

-- CreateIndex
CREATE INDEX "providers_email_idx" ON "providers"("email");

-- CreateIndex
CREATE INDEX "providers_status_practice_id_idx" ON "providers"("status", "practice_id");

-- AddForeignKey
ALTER TABLE "aetna_enrollment_runs" ADD CONSTRAINT "aetna_enrollment_runs_payer_enrollment_id_fkey" FOREIGN KEY ("payer_enrollment_id") REFERENCES "payer_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aetna_enrollment_runs" ADD CONSTRAINT "aetna_enrollment_runs_initiated_by_id_fkey" FOREIGN KEY ("initiated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

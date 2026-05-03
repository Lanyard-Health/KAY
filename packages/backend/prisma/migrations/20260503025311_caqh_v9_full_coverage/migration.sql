-- AlterTable
ALTER TABLE "hospital_affiliations" ADD COLUMN     "admission_percent" INTEGER,
ADD COLUMN     "admitting_contact_email" TEXT,
ADD COLUMN     "admitting_contact_phone" TEXT,
ADD COLUMN     "admitting_provider_first_name" TEXT,
ADD COLUMN     "admitting_provider_last_name" TEXT,
ADD COLUMN     "caqh_aha_id" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "end_date" TIMESTAMP(3),
ADD COLUMN     "exit_explanation" TEXT,
ADD COLUMN     "fax_number" TEXT,
ADD COLUMN     "is_admitter_same_specialty" BOOLEAN,
ADD COLUMN     "phone_number" TEXT,
ADD COLUMN     "reason_for_discontinuance" TEXT,
ADD COLUMN     "staff_category" TEXT,
ADD COLUMN     "who_admits_for_you" TEXT;

-- AlterTable
ALTER TABLE "malpractice_claims" ADD COLUMN     "caqh_claim_id" TEXT,
ADD COLUMN     "case_involvement" TEXT,
ADD COLUMN     "court_address_line_1" TEXT,
ADD COLUMN     "court_city" TEXT,
ADD COLUMN     "court_country" TEXT,
ADD COLUMN     "court_phone" TEXT,
ADD COLUMN     "court_state" TEXT,
ADD COLUMN     "court_zip_code" TEXT,
ADD COLUMN     "npdb_reported" BOOLEAN,
ADD COLUMN     "number_other_codefendants" INTEGER,
ADD COLUMN     "patient_died" BOOLEAN,
ADD COLUMN     "patient_injury_description" TEXT,
ADD COLUMN     "resolution_method" TEXT,
ADD COLUMN     "settlement_amount_paid" DECIMAL(15,2);

-- AlterTable
ALTER TABLE "supervising_physicians" ADD COLUMN     "caqh_supervisor_id" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "practice_location_id" TEXT,
ADD COLUMN     "source" "CredentialSource" NOT NULL DEFAULT 'manual_entry';

-- AlterTable
ALTER TABLE "work_histories" ADD COLUMN     "caqh_work_history_id" TEXT,
ADD COLUMN     "current_employer_flag" BOOLEAN,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "fax" TEXT;

-- CreateTable
CREATE TABLE "work_history_gaps" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "gap_explanation" TEXT,
    "gap_description" TEXT,
    "caqh_gap_id" TEXT,
    "source" "CredentialSource" NOT NULL DEFAULT 'manual_entry',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "work_history_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_history_gaps_provider_id_idx" ON "work_history_gaps"("provider_id");

-- CreateIndex
CREATE INDEX "work_history_gaps_provider_id_caqh_gap_id_idx" ON "work_history_gaps"("provider_id", "caqh_gap_id");

-- CreateIndex
CREATE INDEX "hospital_affiliations_provider_id_caqh_aha_id_idx" ON "hospital_affiliations"("provider_id", "caqh_aha_id");

-- CreateIndex
CREATE INDEX "malpractice_claims_provider_id_caqh_claim_id_idx" ON "malpractice_claims"("provider_id", "caqh_claim_id");

-- CreateIndex
CREATE INDEX "supervising_physicians_provider_id_practice_location_id_idx" ON "supervising_physicians"("provider_id", "practice_location_id");

-- CreateIndex
CREATE INDEX "supervising_physicians_provider_id_caqh_supervisor_id_idx" ON "supervising_physicians"("provider_id", "caqh_supervisor_id");

-- CreateIndex
CREATE INDEX "work_histories_provider_id_caqh_work_history_id_idx" ON "work_histories"("provider_id", "caqh_work_history_id");

-- AddForeignKey
ALTER TABLE "work_history_gaps" ADD CONSTRAINT "work_history_gaps_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_history_gaps" ADD CONSTRAINT "work_history_gaps_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_history_gaps" ADD CONSTRAINT "work_history_gaps_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supervising_physicians" ADD CONSTRAINT "supervising_physicians_practice_location_id_fkey" FOREIGN KEY ("practice_location_id") REFERENCES "practice_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

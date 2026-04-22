-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IdentifierType" ADD VALUE 'CDS';
ALTER TYPE "IdentifierType" ADD VALUE 'ACLS';
ALTER TYPE "IdentifierType" ADD VALUE 'BLS';
ALTER TYPE "IdentifierType" ADD VALUE 'PALS';
ALTER TYPE "IdentifierType" ADD VALUE 'CPR';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PrivilegeType" ADD VALUE 'active';
ALTER TYPE "PrivilegeType" ADD VALUE 'provisional';
ALTER TYPE "PrivilegeType" ADD VALUE 'affiliate';
ALTER TYPE "PrivilegeType" ADD VALUE 'teaching';

-- AlterTable
ALTER TABLE "board_certifications" ADD COLUMN     "is_board_certified" BOOLEAN,
ADD COLUMN     "nucc_taxonomy_code" TEXT,
ALTER COLUMN "initial_certification_date" DROP NOT NULL;

-- AlterTable
ALTER TABLE "dea_registrations" ADD COLUMN     "buprenorphine_waiver" BOOLEAN,
ADD COLUMN     "source" "CredentialSource" NOT NULL DEFAULT 'manual_entry',
ALTER COLUMN "issue_date" DROP NOT NULL;

-- AlterTable
ALTER TABLE "disciplinary_actions" ADD COLUMN     "appeal_status" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "effective_date" TIMESTAMP(3),
ADD COLUMN     "narrative" TEXT,
ADD COLUMN     "source" "CredentialSource" NOT NULL DEFAULT 'manual_entry',
ALTER COLUMN "date_of_action" DROP NOT NULL;

-- AlterTable
ALTER TABLE "educations" ADD COLUMN     "address_line_1" TEXT,
ADD COLUMN     "postal_code" TEXT,
ALTER COLUMN "field_of_study" DROP NOT NULL,
ALTER COLUMN "start_date" DROP NOT NULL;

-- AlterTable
ALTER TABLE "hospital_affiliations" ADD COLUMN     "address_line_1" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "has_temporary_privileges" BOOLEAN,
ADD COLUMN     "has_unrestricted_privileges" BOOLEAN,
ADD COLUMN     "hospital_affiliation_type" TEXT,
ADD COLUMN     "hospital_record_type" TEXT,
ADD COLUMN     "non_aha_hospital_name" TEXT,
ADD COLUMN     "privilege_description" TEXT,
ADD COLUMN     "source" "CredentialSource" NOT NULL DEFAULT 'manual_entry',
ADD COLUMN     "start_date" TIMESTAMP(3),
ADD COLUMN     "zip_code" TEXT;

-- AlterTable
ALTER TABLE "licenses" ADD COLUMN     "caqh_license_id" TEXT,
ADD COLUMN     "currently_practicing" BOOLEAN,
ADD COLUMN     "is_primary" BOOLEAN,
ALTER COLUMN "issue_date" DROP NOT NULL;

-- AlterTable
ALTER TABLE "malpractice_claims" ADD COLUMN     "allegation_description" TEXT,
ADD COLUMN     "defendant_role" TEXT,
ADD COLUMN     "is_lead_defendant" BOOLEAN,
ADD COLUMN     "narrative" TEXT,
ADD COLUMN     "patient_gender_age" TEXT,
ADD COLUMN     "source" "CredentialSource" NOT NULL DEFAULT 'manual_entry',
ALTER COLUMN "date_of_incident" DROP NOT NULL,
ALTER COLUMN "date_of_claim" DROP NOT NULL;

-- AlterTable
ALTER TABLE "malpractice_insurances" ADD COLUMN     "has_unlimited_coverage" BOOLEAN,
ADD COLUMN     "is_individual_coverage" BOOLEAN,
ADD COLUMN     "is_self_insured" BOOLEAN,
ADD COLUMN     "source" "CredentialSource" NOT NULL DEFAULT 'manual_entry';

-- AlterTable
ALTER TABLE "practice_locations" ADD COLUMN     "currently_practicing" BOOLEAN,
ADD COLUMN     "has_practice_limitation" BOOLEAN,
ADD COLUMN     "interpreter_available" BOOLEAN,
ADD COLUMN     "practice_specialty" TEXT,
ADD COLUMN     "source" "CredentialSource" NOT NULL DEFAULT 'manual_entry';

-- AlterTable
ALTER TABLE "professional_references" ADD COLUMN     "address_line_1" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT DEFAULT 'US',
ADD COLUMN     "postal_code" TEXT,
ADD COLUMN     "source" "CredentialSource" NOT NULL DEFAULT 'manual_entry',
ADD COLUMN     "state" TEXT,
ALTER COLUMN "title" SET DEFAULT '',
ALTER COLUMN "organization" SET DEFAULT '',
ALTER COLUMN "relationship" SET DEFAULT '',
ALTER COLUMN "email" SET DEFAULT '',
ALTER COLUMN "phone" SET DEFAULT '',
ALTER COLUMN "years_known" DROP NOT NULL;

-- AlterTable
ALTER TABLE "provider_disclosures" ADD COLUMN     "caqh_question_id" TEXT,
ADD COLUMN     "source" "CredentialSource" NOT NULL DEFAULT 'manual_entry';

-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "active_military_flag" BOOLEAN,
ADD COLUMN     "ecfmg_flag" BOOLEAN,
ADD COLUMN     "ecfmg_issue_date" TIMESTAMP(3),
ADD COLUMN     "ecfmg_number" TEXT,
ADD COLUMN     "fellowship_training_flag" BOOLEAN,
ADD COLUMN     "hospital_admitting_arrangements" JSONB,
ADD COLUMN     "hospital_based_flag" BOOLEAN,
ADD COLUMN     "hospital_privilege_flag" BOOLEAN,
ADD COLUMN     "military_service_data" JSONB,
ADD COLUMN     "other_practice_state" TEXT,
ADD COLUMN     "primary_practice_state" TEXT,
ADD COLUMN     "secondary_specialty_flag" BOOLEAN,
ADD COLUMN     "work_history_gap_flag" BOOLEAN;

-- AlterTable
ALTER TABLE "work_histories" ADD COLUMN     "country" TEXT DEFAULT 'US',
ADD COLUMN     "source" "CredentialSource" NOT NULL DEFAULT 'manual_entry',
ADD COLUMN     "status_description" TEXT,
ADD COLUMN     "work_history_type" TEXT,
ALTER COLUMN "organization_type" SET DEFAULT '',
ALTER COLUMN "position" SET DEFAULT '',
ALTER COLUMN "start_date" DROP NOT NULL;

-- CreateTable
CREATE TABLE "covering_colleagues" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "npi" TEXT,
    "specialty" TEXT,
    "relationship" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "caqh_associate_id" TEXT,
    "source" "CredentialSource" NOT NULL DEFAULT 'manual_entry',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "covering_colleagues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "covering_colleagues_provider_id_idx" ON "covering_colleagues"("provider_id");

-- AddForeignKey
ALTER TABLE "covering_colleagues" ADD CONSTRAINT "covering_colleagues_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "covering_colleagues" ADD CONSTRAINT "covering_colleagues_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "covering_colleagues" ADD CONSTRAINT "covering_colleagues_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

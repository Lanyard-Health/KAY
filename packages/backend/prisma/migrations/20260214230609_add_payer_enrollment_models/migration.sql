-- CreateEnum
CREATE TYPE "SupervisionType" AS ENUM ('DIRECT', 'GENERAL', 'COLLABORATIVE', 'ADMINISTRATIVE');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('OPEN', 'SETTLED', 'DISMISSED', 'JUDGMENT_FOR_PROVIDER', 'JUDGMENT_AGAINST_PROVIDER', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DisclosureCategory" AS ENUM ('LICENSE_ACTION', 'HOSPITAL_PRIVILEGES', 'FELONY_CONVICTION', 'MISDEMEANOR_CONVICTION', 'SUBSTANCE_ABUSE', 'MALPRACTICE', 'MEDICARE_MEDICAID', 'BOARD_ACTION', 'INSURANCE_DENIAL', 'ABILITY_TO_PERFORM', 'OTHER');

-- CreateEnum
CREATE TYPE "IdentifierType" AS ENUM ('MEDICARE_PTAN', 'MEDICARE_PECOS_ID', 'MEDICAID_ID', 'TRICARE_ID', 'RAILROAD_MEDICARE_ID', 'STATE_LICENSE_ID', 'PAYER_SPECIFIC_ID', 'UPIN', 'OTHER');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('CHECKING', 'SAVINGS');

-- CreateEnum
CREATE TYPE "CitizenshipStatus" AS ENUM ('US_CITIZEN', 'PERMANENT_RESIDENT', 'WORK_VISA', 'OTHER');

-- CreateEnum
CREATE TYPE "EducationType" AS ENUM ('UNDERGRADUATE', 'MEDICAL_SCHOOL', 'GRADUATE_SCHOOL', 'INTERNSHIP', 'RESIDENCY', 'FELLOWSHIP', 'POST_DOCTORAL', 'CONTINUING_EDUCATION', 'OTHER');

-- AlterTable
ALTER TABLE "educations" ADD COLUMN     "education_type" "EducationType",
ADD COLUMN     "program_director" TEXT,
ADD COLUMN     "program_director_phone" TEXT;

-- AlterTable
ALTER TABLE "malpractice_insurances" ADD COLUMN     "gap_explanation" TEXT,
ADD COLUMN     "has_gap_in_coverage" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retroactive_date" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "practice_locations" ADD COLUMN     "billing_address_line_1" TEXT,
ADD COLUMN     "billing_address_line_2" TEXT,
ADD COLUMN     "billing_city" TEXT,
ADD COLUMN     "billing_state" TEXT,
ADD COLUMN     "billing_zip_code" TEXT,
ADD COLUMN     "medicare_pos" TEXT;

-- CreateTable
CREATE TABLE "supervising_physicians" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "supervisor_first_name" TEXT NOT NULL,
    "supervisor_last_name" TEXT NOT NULL,
    "supervisor_middle_name" TEXT,
    "supervisor_npi" TEXT,
    "supervisor_license_number" TEXT,
    "supervisor_license_state" TEXT,
    "supervisor_specialty" TEXT,
    "supervisor_phone" TEXT,
    "supervisor_email" TEXT,
    "supervision_type" "SupervisionType" NOT NULL,
    "agreement_start_date" TIMESTAMP(3) NOT NULL,
    "agreement_end_date" TIMESTAMP(3),
    "state_requirement" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "supervising_physicians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "malpractice_claims" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "date_of_incident" TIMESTAMP(3) NOT NULL,
    "date_of_claim" TIMESTAMP(3) NOT NULL,
    "claim_status" "ClaimStatus" NOT NULL,
    "description" TEXT NOT NULL,
    "settlement_amount" DECIMAL(15,2),
    "judgment_amount" DECIMAL(15,2),
    "date_resolved" TIMESTAMP(3),
    "insurance_carrier" TEXT,
    "policy_number" TEXT,
    "court_name" TEXT,
    "case_number" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "malpractice_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_disclosures" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "category" "DisclosureCategory" NOT NULL,
    "question_text" TEXT NOT NULL,
    "answer" BOOLEAN NOT NULL DEFAULT false,
    "explanation" TEXT,
    "date_of_occurrence" TIMESTAMP(3),
    "state" TEXT,
    "resolution_details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "provider_disclosures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dea_registrations" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "dea_number" TEXT NOT NULL,
    "dea_state" TEXT,
    "dea_schedules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "issue_date" TIMESTAMP(3) NOT NULL,
    "expiration_date" TIMESTAMP(3) NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "dea_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_identifiers" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "identifier_type" "IdentifierType" NOT NULL,
    "identifier_value" TEXT NOT NULL,
    "issuing_entity" TEXT,
    "state" TEXT,
    "effective_date" TIMESTAMP(3),
    "expiration_date" TIMESTAMP(3),
    "status" "CredentialStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "provider_identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_banking" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "bank_account_type" "BankAccountType" NOT NULL,
    "routing_number_encrypted" TEXT NOT NULL,
    "account_number_encrypted" TEXT NOT NULL,
    "account_number_last4" TEXT NOT NULL,
    "account_holder_name" TEXT NOT NULL,
    "account_holder_tax_id" TEXT,
    "eft_authorization_date" TIMESTAMP(3),
    "w9_on_file" BOOLEAN NOT NULL DEFAULT false,
    "voided_check_on_file" BOOLEAN NOT NULL DEFAULT false,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "provider_banking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_demographics" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "birth_city" TEXT,
    "birth_state" TEXT,
    "birth_country" TEXT,
    "citizenship_status" "CitizenshipStatus",
    "visa_type" TEXT,
    "visa_expiration_date" TIMESTAMP(3),
    "previous_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ethnicity" TEXT,
    "race" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "emergency_contact_relation" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_demographics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_demographics_provider_id_key" ON "provider_demographics"("provider_id");

-- AddForeignKey
ALTER TABLE "supervising_physicians" ADD CONSTRAINT "supervising_physicians_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "malpractice_claims" ADD CONSTRAINT "malpractice_claims_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_disclosures" ADD CONSTRAINT "provider_disclosures_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dea_registrations" ADD CONSTRAINT "dea_registrations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_identifiers" ADD CONSTRAINT "provider_identifiers_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_banking" ADD CONSTRAINT "provider_banking_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_demographics" ADD CONSTRAINT "provider_demographics_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

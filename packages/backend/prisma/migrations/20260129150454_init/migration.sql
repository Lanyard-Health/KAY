-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'credentialing_staff', 'provider');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('active', 'inactive', 'pending');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('psychiatrist', 'psychologist', 'lcsw', 'lpc', 'lmft', 'pmhnp', 'other');

-- CreateEnum
CREATE TYPE "CaqhStatus" AS ENUM ('active', 'inactive', 'pending', 'expired');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('home', 'practice', 'mailing', 'billing');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('active', 'expired', 'pending', 'revoked');

-- CreateEnum
CREATE TYPE "LicenseType" AS ENUM ('state_medical', 'state_psychology', 'state_social_work', 'state_counseling', 'state_marriage_family', 'dea', 'controlled_substance', 'npi');

-- CreateEnum
CREATE TYPE "BoardType" AS ENUM ('abpn_psychiatry', 'abpn_child_adolescent', 'abpn_addiction', 'abpp_clinical', 'abpp_counseling', 'abecsw', 'nbcc', 'aamft', 'ancc_pmhnp', 'other');

-- CreateEnum
CREATE TYPE "CoverageType" AS ENUM ('occurrence', 'claims_made');

-- CreateEnum
CREATE TYPE "DegreeType" AS ENUM ('md', 'do', 'phd', 'psyd', 'msw', 'ma', 'ms', 'med', 'dnp', 'msn', 'bs', 'ba', 'other');

-- CreateEnum
CREATE TYPE "PrivilegeType" AS ENUM ('admitting', 'courtesy', 'consulting', 'temporary', 'locum_tenens');

-- CreateEnum
CREATE TYPE "AffiliationStatus" AS ENUM ('active', 'pending', 'inactive', 'denied', 'resigned');

-- CreateEnum
CREATE TYPE "DisciplinaryActionType" AS ENUM ('license_action', 'hospital_action', 'malpractice_claim', 'legal_action', 'other');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('license', 'board_certification', 'malpractice_certificate', 'diploma', 'transcript', 'cv_resume', 'photo', 'government_id', 'dea_certificate', 'cds_certificate', 'cme_certificate', 'hospital_letter', 'reference_letter', 'other');

-- CreateEnum
CREATE TYPE "OcrStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'not_applicable');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('not_started', 'in_progress', 'submitted', 'pending_review', 'approved', 'denied', 'terminated');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('create', 'read', 'update', 'delete', 'login', 'logout', 'export', 'import');

-- CreateEnum
CREATE TYPE "CaqhSyncStatus" AS ENUM ('pending', 'in_progress', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "CaqhSyncDirection" AS ENUM ('pull', 'push');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('expiration_reminder', 'enrollment_status', 'document_uploaded', 'verification_complete');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sent', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "cognito_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "provider_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" TEXT NOT NULL,
    "npi" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "suffix" TEXT,
    "maiden_name" TEXT,
    "date_of_birth" TIMESTAMP(3) NOT NULL,
    "gender" "Gender" NOT NULL,
    "ssn_encrypted" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "mobile_phone" TEXT,
    "fax" TEXT,
    "provider_type" "ProviderType" NOT NULL,
    "taxonomy" TEXT,
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "caqh_provider_id" TEXT,
    "caqh_status" "CaqhStatus",
    "caqh_last_sync" TIMESTAMP(3),
    "status" "ProviderStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_addresses" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "type" "AddressType" NOT NULL,
    "address_line_1" TEXT NOT NULL,
    "address_line_2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip_code" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "licenses" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "license_type" "LicenseType" NOT NULL,
    "license_number" TEXT NOT NULL,
    "state" TEXT,
    "issue_date" TIMESTAMP(3) NOT NULL,
    "expiration_date" TIMESTAMP(3) NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'active',
    "verification_date" TIMESTAMP(3),
    "verification_source" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_certifications" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "board_type" "BoardType" NOT NULL,
    "board_name" TEXT NOT NULL,
    "certification_number" TEXT,
    "specialty" TEXT NOT NULL,
    "initial_certification_date" TIMESTAMP(3) NOT NULL,
    "expiration_date" TIMESTAMP(3),
    "status" "CredentialStatus" NOT NULL DEFAULT 'active',
    "is_board_eligible" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "board_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "malpractice_insurances" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "carrier_name" TEXT NOT NULL,
    "policy_number" TEXT NOT NULL,
    "coverage_type" "CoverageType" NOT NULL,
    "per_claim_amount" DECIMAL(15,2) NOT NULL,
    "aggregate_amount" DECIMAL(15,2) NOT NULL,
    "effective_date" TIMESTAMP(3) NOT NULL,
    "expiration_date" TIMESTAMP(3) NOT NULL,
    "has_tail_coverage" BOOLEAN NOT NULL DEFAULT false,
    "status" "CredentialStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "malpractice_insurances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "educations" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "institution_name" TEXT NOT NULL,
    "degree" "DegreeType" NOT NULL,
    "field_of_study" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'US',
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "graduation_date" TIMESTAMP(3),
    "is_completed" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "educations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_histories" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "organization_name" TEXT NOT NULL,
    "organization_type" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "department" TEXT,
    "address_line_1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip_code" TEXT,
    "phone" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "reason_for_leaving" TEXT,
    "supervisor_name" TEXT,
    "supervisor_phone" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "work_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hospital_affiliations" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "facility_name" TEXT NOT NULL,
    "facility_type" TEXT NOT NULL,
    "privilege_type" "PrivilegeType" NOT NULL,
    "status" "AffiliationStatus" NOT NULL,
    "appointment_date" TIMESTAMP(3),
    "reappointment_date" TIMESTAMP(3),
    "city" TEXT,
    "state" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "hospital_affiliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_references" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "years_known" INTEGER NOT NULL,
    "can_contact" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "professional_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disciplinary_actions" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "action_type" "DisciplinaryActionType" NOT NULL,
    "description" TEXT NOT NULL,
    "date_of_action" TIMESTAMP(3) NOT NULL,
    "state" TEXT,
    "agency" TEXT,
    "outcome" TEXT,
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolution_date" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "disciplinary_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "continuing_educations" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "course_name" TEXT NOT NULL,
    "course_provider" TEXT NOT NULL,
    "credits" DECIMAL(5,2) NOT NULL,
    "credit_type" TEXT NOT NULL,
    "completion_date" TIMESTAMP(3) NOT NULL,
    "certificate_number" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "continuing_educations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "original_file_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "description" TEXT,
    "linked_license_id" TEXT,
    "linked_board_certification_id" TEXT,
    "linked_malpractice_insurance_id" TEXT,
    "linked_education_id" TEXT,
    "linked_continuing_education_id" TEXT,
    "expiration_date" TIMESTAMP(3),
    "ocr_status" "OcrStatus" NOT NULL DEFAULT 'not_applicable',
    "ocr_data" JSONB,
    "ocr_confidence" DOUBLE PRECISION,
    "ocr_reviewed_at" TIMESTAMP(3),
    "ocr_reviewed_by" TEXT,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "verified_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payer_id" TEXT NOT NULL,
    "payer_type" TEXT NOT NULL,
    "address_line_1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip_code" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payer_enrollments" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "payer_id" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'not_started',
    "application_date" TIMESTAMP(3),
    "effective_date" TIMESTAMP(3),
    "termination_date" TIMESTAMP(3),
    "provider_number" TEXT,
    "group_number" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "payer_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" "AuditAction" NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "changes" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caqh_sync_logs" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "direction" "CaqhSyncDirection" NOT NULL,
    "status" "CaqhSyncStatus" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "changes_applied" JSONB,

    CONSTRAINT "caqh_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMP(3),
    "error_message" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_cognito_id_key" ON "users"("cognito_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_provider_id_key" ON "users"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "providers_npi_key" ON "providers"("npi");

-- CreateIndex
CREATE UNIQUE INDEX "payers_payer_id_key" ON "payers"("payer_id");

-- CreateIndex
CREATE UNIQUE INDEX "payer_enrollments_provider_id_payer_id_key" ON "payer_enrollments"("provider_id", "payer_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_idx" ON "audit_logs"("resource_type");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "caqh_sync_logs_provider_id_idx" ON "caqh_sync_logs"("provider_id");

-- CreateIndex
CREATE INDEX "notifications_status_idx" ON "notifications"("status");

-- CreateIndex
CREATE INDEX "notifications_type_idx" ON "notifications"("type");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_addresses" ADD CONSTRAINT "provider_addresses_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_certifications" ADD CONSTRAINT "board_certifications_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "malpractice_insurances" ADD CONSTRAINT "malpractice_insurances_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "educations" ADD CONSTRAINT "educations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_histories" ADD CONSTRAINT "work_histories_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospital_affiliations" ADD CONSTRAINT "hospital_affiliations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_references" ADD CONSTRAINT "professional_references_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disciplinary_actions" ADD CONSTRAINT "disciplinary_actions_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "continuing_educations" ADD CONSTRAINT "continuing_educations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_linked_license_id_fkey" FOREIGN KEY ("linked_license_id") REFERENCES "licenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_linked_board_certification_id_fkey" FOREIGN KEY ("linked_board_certification_id") REFERENCES "board_certifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_linked_malpractice_insurance_id_fkey" FOREIGN KEY ("linked_malpractice_insurance_id") REFERENCES "malpractice_insurances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_linked_education_id_fkey" FOREIGN KEY ("linked_education_id") REFERENCES "educations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_linked_continuing_education_id_fkey" FOREIGN KEY ("linked_continuing_education_id") REFERENCES "continuing_educations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_ocr_reviewed_by_fkey" FOREIGN KEY ("ocr_reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_enrollments" ADD CONSTRAINT "payer_enrollments_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_enrollments" ADD CONSTRAINT "payer_enrollments_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

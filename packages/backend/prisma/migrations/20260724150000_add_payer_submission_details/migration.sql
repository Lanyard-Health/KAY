CREATE TABLE "payer_submission_details" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "fax" TEXT,
    "county" TEXT,
    "place_of_service" TEXT,
    "ada_accessible" BOOLEAN NOT NULL DEFAULT false,
    "access_accommodations" TEXT,
    "working_days" TEXT,
    "office_hours" TEXT,
    "facility_fee" BOOLEAN NOT NULL DEFAULT false,
    "telehealth" BOOLEAN NOT NULL DEFAULT false,
    "telehealth_services" TEXT,
    "telehealth_methods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "telehealth_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "telehealth_hipaa_attested" BOOLEAN NOT NULL DEFAULT false,
    "submitter_first_name" TEXT,
    "submitter_last_name" TEXT,
    "submitter_role" TEXT,
    "submitter_email" TEXT,
    "submitter_phone" TEXT,
    "staff_languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "interpreter_languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "provider_languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "asl_offered" BOOLEAN NOT NULL DEFAULT false,
    "medicare_certified" BOOLEAN NOT NULL DEFAULT false,
    "medicare_ptan" TEXT,
    "medicaid_certified" BOOLEAN NOT NULL DEFAULT false,
    "eap_participation" BOOLEAN NOT NULL DEFAULT false,
    "hospital_admitting_privileges" BOOLEAN NOT NULL DEFAULT false,
    "facility_admitting_privileges" BOOLEAN NOT NULL DEFAULT false,
    "bh_age_groups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bh_practice_focus" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "w9_document_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payer_submission_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payer_submission_details_provider_id_key" ON "payer_submission_details"("provider_id");

-- AddForeignKey
ALTER TABLE "payer_submission_details" ADD CONSTRAINT "payer_submission_details_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_submission_details" ADD CONSTRAINT "payer_submission_details_w9_document_id_fkey" FOREIGN KEY ("w9_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Practice intake fields
ALTER TABLE "practices" ADD COLUMN "account_id" TEXT;
ALTER TABLE "practices" ADD COLUMN "is_enterprise" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "practices" ADD COLUMN "location_name" TEXT;
ALTER TABLE "practices" ADD COLUMN "is_primary_location" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "practices" ADD COLUMN "states" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "practices" ADD COLUMN "target_payer_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "practices" ADD COLUMN "provider_types" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- ProviderProfile intake fields
ALTER TABLE "providers" ADD COLUMN "target_payers" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "providers" ADD COLUMN "target_states" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "providers" ADD COLUMN "entity_type" TEXT;

-- Enrollment linkage fields (relations added in next migration when models exist)
ALTER TABLE "payer_enrollments" ADD COLUMN "payer_track_id" TEXT;
ALTER TABLE "payer_enrollments" ADD COLUMN "workflow_template_id" TEXT;

-- EnrollmentWorkflowStep dueDate
ALTER TABLE "enrollment_workflow_steps" ADD COLUMN "due_date" TIMESTAMP(3);

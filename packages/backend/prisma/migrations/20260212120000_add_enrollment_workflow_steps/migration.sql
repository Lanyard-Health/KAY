-- Migration: add_enrollment_workflow_steps
-- Adds workflow step tracking to payer enrollments
-- Backward-compatible: existing enrollments continue to work unchanged

-- ============================================================
-- NEW ENUMS
-- ============================================================

CREATE TYPE "WorkflowType" AS ENUM ('medical', 'behavioral_health');

CREATE TYPE "WorkflowStepStatus" AS ENUM ('not_started', 'in_progress', 'completed', 'skipped', 'blocked');

CREATE TYPE "WorkflowActionType" AS ENUM ('form_submission', 'phone_call', 'caqh_update', 'portal_registration', 'document_upload', 'waiting_period', 'follow_up', 'verification');

CREATE TYPE "WorkflowStepOwner" AS ENUM ('provider', 'credentialing_staff', 'payer', 'cvo');

-- ============================================================
-- ALTER EXISTING TABLES
-- ============================================================

-- Add workflow_key to payers (links to JSON template)
ALTER TABLE "payers" ADD COLUMN "workflow_key" TEXT;

-- Add workflow_type to payer_enrollments
ALTER TABLE "payer_enrollments" ADD COLUMN "workflow_type" "WorkflowType";

-- ============================================================
-- NEW TABLE: enrollment_workflow_steps
-- ============================================================

CREATE TABLE "enrollment_workflow_steps" (
    "id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,

    -- Template reference
    "template_step_id" TEXT NOT NULL,
    "step_order" INTEGER NOT NULL,

    -- Step details (snapshot from template at creation)
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "action_type" "WorkflowActionType" NOT NULL,
    "url" TEXT,
    "owner" "WorkflowStepOwner" NOT NULL,
    "estimated_days" INTEGER NOT NULL,

    -- Dependencies & requirements
    "dependencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "documents_needed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],

    -- Progress tracking
    "status" "WorkflowStepStatus" NOT NULL DEFAULT 'not_started',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "completed_by_id" TEXT,
    "skipped_reason" TEXT,
    "notes" TEXT,

    -- Audit
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollment_workflow_steps_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX "enrollment_workflow_steps_enrollment_id_idx"
    ON "enrollment_workflow_steps"("enrollment_id");

CREATE INDEX "enrollment_workflow_steps_status_idx"
    ON "enrollment_workflow_steps"("status");

CREATE INDEX "enrollment_workflow_steps_enrollment_order_idx"
    ON "enrollment_workflow_steps"("enrollment_id", "step_order");

-- ============================================================
-- FOREIGN KEYS
-- ============================================================

ALTER TABLE "enrollment_workflow_steps"
    ADD CONSTRAINT "enrollment_workflow_steps_enrollment_id_fkey"
    FOREIGN KEY ("enrollment_id") REFERENCES "payer_enrollments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "enrollment_workflow_steps"
    ADD CONSTRAINT "enrollment_workflow_steps_completed_by_id_fkey"
    FOREIGN KEY ("completed_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- SEED WORKFLOW KEYS FOR KNOWN PAYERS
-- ============================================================

UPDATE "payers" SET "workflow_key" = 'aetna'
    WHERE LOWER("name") LIKE '%aetna%' AND "workflow_key" IS NULL;

UPDATE "payers" SET "workflow_key" = 'cigna'
    WHERE (LOWER("name") LIKE '%cigna%' OR LOWER("name") LIKE '%evernorth%')
    AND "workflow_key" IS NULL;

UPDATE "payers" SET "workflow_key" = 'uhc'
    WHERE (LOWER("name") LIKE '%united%health%' OR LOWER("name") LIKE '%uhc%')
    AND "workflow_key" IS NULL;

UPDATE "payers" SET "workflow_key" = 'optum'
    WHERE LOWER("name") LIKE '%optum%' AND "workflow_key" IS NULL;

UPDATE "payers" SET "workflow_key" = 'humana'
    WHERE LOWER("name") LIKE '%humana%' AND "workflow_key" IS NULL;

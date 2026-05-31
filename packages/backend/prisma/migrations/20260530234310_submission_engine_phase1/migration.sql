-- =====================================================================
-- Phase 1 — Submission Engine: Tenant Isolation + Foundation
--
-- 8 new enums, 5 new tables (PortalCredential, SubmissionJob, FaxJob,
-- PecosSubmission, StateMedicaidEnrollment), 5 String→enum conversions,
-- new columns on EnrollmentRun + AgentWorkflow, AuditAction enum extension.
--
-- Manual edits vs Prisma-generated:
--   * pgvector HNSW DROP INDEX REMOVED — preserves knowledge_base index.
--   * agent_workflows.practice_id added as nullable, backfilled from
--     providers.practice_id, then ALTER SET NOT NULL.
--   * payer_forms.format and .delivery_engine converted via ALTER TYPE USING
--     instead of DROP+ADD — preserves existing data on 21 rows.
--   * Pre-migration data cleanup (demo row delete, casing normalization)
--     was applied to dev DB on 2026-05-30 as a separate transaction.
-- =====================================================================

-- CreateEnum
CREATE TYPE "AdapterType" AS ENUM ('CAQH', 'PLAYWRIGHT_GENERIC', 'AETNA_BH', 'AVAILITY', 'MANUAL', 'FAX');

-- CreateEnum
CREATE TYPE "SubmissionMethod" AS ENUM ('WEB_PORTAL', 'API', 'FAX', 'EMAIL', 'MANUAL');

-- CreateEnum
CREATE TYPE "DeliveryEngine" AS ENUM ('BROWSER', 'FAX', 'EMAIL', 'MANUAL');

-- CreateEnum
CREATE TYPE "PayerFormFormat" AS ENUM ('ONLINE', 'PDF', 'PORTAL');

-- CreateEnum
CREATE TYPE "EnrollmentRunStatus" AS ENUM ('PENDING', 'QUEUED', 'FILLING', 'AWAITING_REVIEW', 'SUBMITTING', 'SUBMITTED', 'ACKNOWLEDGED', 'APPROVED', 'DENIED', 'FAILED', 'CANCELLED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "PortalCredentialType" AS ENUM ('GROUP', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "SubmissionJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTERED');

-- CreateEnum
CREATE TYPE "FaxJobStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'DEAD_LETTERED');

-- AlterEnum — extend AuditAction with 8 submission engine values
ALTER TYPE "AuditAction" ADD VALUE 'SUBMISSION_QUEUED';
ALTER TYPE "AuditAction" ADD VALUE 'SUBMISSION_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'SUBMISSION_SKIPPED_IDEMPOTENT';
ALTER TYPE "AuditAction" ADD VALUE 'SUBMISSION_FORM_FILLED';
ALTER TYPE "AuditAction" ADD VALUE 'SUBMISSION_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'SUBMISSION_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE 'SUBMISSION_ATTEMPT_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'SUBMISSION_DEAD_LETTERED';

-- =====================================================================
-- agent_workflows.practice_id — 3-step backfill
-- 23 existing rows have providerId; we resolve practice_id through
-- providers.practice_id. Fails the migration if any row can't be backfilled.
-- =====================================================================

-- Step 1: Add nullable column
ALTER TABLE "agent_workflows" ADD COLUMN "practice_id" TEXT;

-- Step 2: Backfill from providers.practice_id
UPDATE "agent_workflows" aw
SET "practice_id" = pp."practice_id"
FROM "providers" pp
WHERE pp.id = aw."provider_id"
  AND pp."practice_id" IS NOT NULL;

-- Step 3: Fail loud if any row is still null — we cannot proceed with a
-- partial column because the credential lookup depends on practice scope.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "agent_workflows" WHERE "practice_id" IS NULL) THEN
    RAISE EXCEPTION 'practice_id backfill incomplete — % rows still null',
      (SELECT COUNT(*) FROM "agent_workflows" WHERE "practice_id" IS NULL);
  END IF;
END $$;

-- Step 4: Enforce NOT NULL
ALTER TABLE "agent_workflows" ALTER COLUMN "practice_id" SET NOT NULL;

-- =====================================================================
-- enrollment_runs.status — DROP+ADD safe because table is empty (verified)
-- =====================================================================
ALTER TABLE "enrollment_runs"
  ADD COLUMN "confirmation_number" TEXT,
  ADD COLUMN "external_reference" TEXT,
  ADD COLUMN "failed_at" TIMESTAMP(3),
  DROP COLUMN "status",
  ADD COLUMN "status" "EnrollmentRunStatus" NOT NULL;

-- =====================================================================
-- payer_adapter_configs.adapter_type + .submission_method
-- DROP+ADD safe because the 2 demo rows were deleted before this migration.
-- =====================================================================
ALTER TABLE "payer_adapter_configs"
  DROP COLUMN "adapter_type",
  ADD COLUMN "adapter_type" "AdapterType" NOT NULL,
  DROP COLUMN "submission_method",
  ADD COLUMN "submission_method" "SubmissionMethod" NOT NULL;

-- =====================================================================
-- payer_forms.format + .delivery_engine — ALTER TYPE USING preserves data.
-- Values were normalized to enum casing (UPPER) before this migration.
-- Format data: 'ONLINE' (9), 'PDF' (8), 'PORTAL' (4) — all valid enum values.
-- Delivery engine data: 'BROWSER' (3) + 18 nulls — all valid.
-- =====================================================================
ALTER TABLE "payer_forms"
  ALTER COLUMN "format" TYPE "PayerFormFormat" USING "format"::"PayerFormFormat";

ALTER TABLE "payer_forms"
  ALTER COLUMN "delivery_engine" TYPE "DeliveryEngine" USING "delivery_engine"::"DeliveryEngine";

-- CreateTable
CREATE TABLE "portal_credentials" (
    "id" TEXT NOT NULL,
    "payer_id" TEXT NOT NULL,
    "practice_id" TEXT,
    "provider_id" TEXT,
    "username_encrypted" TEXT NOT NULL,
    "password_encrypted" TEXT NOT NULL,
    "mfa_seed_encrypted" TEXT,
    "extra_config_encrypted" TEXT,
    "credential_type" "PortalCredentialType" NOT NULL,
    "last_verified_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_jobs" (
    "id" TEXT NOT NULL,
    "enrollment_run_id" TEXT NOT NULL,
    "bullmq_job_id" TEXT NOT NULL,
    "status" "SubmissionJobStatus" NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "last_error" TEXT,
    "last_attempt_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "confirmation_number" TEXT,
    "pre_screenshot_key" TEXT,
    "post_screenshot_key" TEXT,
    "raw_response_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submission_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fax_jobs" (
    "id" TEXT NOT NULL,
    "submission_job_id" TEXT,
    "enrollment_run_id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "payer_id" TEXT NOT NULL,
    "to_fax_number" TEXT NOT NULL,
    "filled_pdf_key" TEXT NOT NULL,
    "cover_sheet_key" TEXT,
    "vendor" TEXT NOT NULL,
    "vendor_fax_id" TEXT,
    "status" "FaxJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "last_attempt_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fax_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pecos_submissions" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pecos_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "state_medicaid_enrollments" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "state_medicaid_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_credentials_practice_id_idx" ON "portal_credentials"("practice_id");

-- CreateIndex
CREATE INDEX "portal_credentials_provider_id_idx" ON "portal_credentials"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "portal_credentials_payer_id_practice_id_key" ON "portal_credentials"("payer_id", "practice_id");

-- CreateIndex
CREATE UNIQUE INDEX "portal_credentials_payer_id_provider_id_key" ON "portal_credentials"("payer_id", "provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_jobs_enrollment_run_id_key" ON "submission_jobs"("enrollment_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_jobs_bullmq_job_id_key" ON "submission_jobs"("bullmq_job_id");

-- CreateIndex
CREATE INDEX "submission_jobs_enrollment_run_id_idx" ON "submission_jobs"("enrollment_run_id");

-- CreateIndex
CREATE INDEX "fax_jobs_enrollment_run_id_idx" ON "fax_jobs"("enrollment_run_id");

-- CreateIndex
CREATE INDEX "fax_jobs_status_idx" ON "fax_jobs"("status");

-- CreateIndex
CREATE INDEX "fax_jobs_practice_id_idx" ON "fax_jobs"("practice_id");

-- CreateIndex
CREATE INDEX "enrollment_runs_status_idx" ON "enrollment_runs"("status");

-- AddForeignKey
ALTER TABLE "agent_workflows" ADD CONSTRAINT "agent_workflows_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_credentials" ADD CONSTRAINT "portal_credentials_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_credentials" ADD CONSTRAINT "portal_credentials_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_credentials" ADD CONSTRAINT "portal_credentials_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_jobs" ADD CONSTRAINT "submission_jobs_enrollment_run_id_fkey" FOREIGN KEY ("enrollment_run_id") REFERENCES "enrollment_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fax_jobs" ADD CONSTRAINT "fax_jobs_submission_job_id_fkey" FOREIGN KEY ("submission_job_id") REFERENCES "submission_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fax_jobs" ADD CONSTRAINT "fax_jobs_enrollment_run_id_fkey" FOREIGN KEY ("enrollment_run_id") REFERENCES "enrollment_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

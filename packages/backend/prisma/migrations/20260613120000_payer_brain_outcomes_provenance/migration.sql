-- Payer Brain — Phase B: outcome recorder + provenance/change-detection foundation
--
-- ADMIN-APPLIED MIGRATION. The runtime role `lanyard_app` cannot ALTER the
-- payer_* tables (owned by kay_staging_user) and cannot CREATE tables — it will
-- 42501. Apply this as kay_staging_user via DATABASE_URL_ADMIN, with Render
-- autoDeploy + the "Render Deploy Watchdog" GitHub Action PAUSED. See
-- prisma/manual/PHASE_B_APPLY_STEPS.md.
--
-- Adding the four UNIQUE indexes will FAIL if duplicate rows exist. Zero dupes
-- were confirmed on staging (2026-06-13). Re-confirm on prod before applying there.

-- CreateEnum
CREATE TYPE "PayerDataOrigin" AS ENUM ('human_curated', 'crawler_promoted');

-- CreateEnum
CREATE TYPE "EnrollmentOutcomeType" AS ENUM ('approved', 'denied', 'terminated', 'stuck');

-- AlterTable
ALTER TABLE "practices" ADD COLUMN     "is_demo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payer_timelines" ADD COLUMN     "captured_at" TIMESTAMP(3),
ADD COLUMN     "content_hash" TEXT,
ADD COLUMN     "origin" "PayerDataOrigin" NOT NULL DEFAULT 'human_curated',
ADD COLUMN     "source_url" TEXT,
ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payer_state_rules" ADD COLUMN     "captured_at" TIMESTAMP(3),
ADD COLUMN     "content_hash" TEXT,
ADD COLUMN     "origin" "PayerDataOrigin" NOT NULL DEFAULT 'human_curated',
ADD COLUMN     "source_url" TEXT,
ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payer_forms" ADD COLUMN     "captured_at" TIMESTAMP(3),
ADD COLUMN     "content_hash" TEXT,
ADD COLUMN     "origin" "PayerDataOrigin" NOT NULL DEFAULT 'human_curated',
ADD COLUMN     "source_url" TEXT,
ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payer_requirements" ADD COLUMN     "captured_at" TIMESTAMP(3),
ADD COLUMN     "content_hash" TEXT,
ADD COLUMN     "origin" "PayerDataOrigin" NOT NULL DEFAULT 'human_curated',
ADD COLUMN     "source_url" TEXT,
ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "enrollment_outcomes" (
    "id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "outcome" "EnrollmentOutcomeType" NOT NULL,
    "payer_id" TEXT NOT NULL,
    "payer_name" TEXT NOT NULL,
    "payer_track_id" TEXT,
    "state" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "provider_type" TEXT NOT NULL,
    "process_type" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "transition_at" TIMESTAMP(3) NOT NULL,
    "application_date" TIMESTAMP(3),
    "effective_date" TIMESTAMP(3),
    "days_to_outcome" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawl_sources" (
    "id" TEXT NOT NULL,
    "payer_track_id" TEXT,
    "state" TEXT,
    "url" TEXT NOT NULL,
    "page_type" TEXT NOT NULL,
    "crawl_frequency" TEXT NOT NULL DEFAULT 'weekly',
    "last_crawled_at" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crawl_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawl_snapshots" (
    "id" TEXT NOT NULL,
    "crawl_source_id" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content_hash" TEXT NOT NULL,
    "raw_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'fetched',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crawl_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payer_requirement_changes" (
    "id" TEXT NOT NULL,
    "payer_track_id" TEXT,
    "state" TEXT,
    "source_url" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "changed_section" TEXT NOT NULL,
    "previous_value" TEXT,
    "new_value" TEXT,
    "change_summary" TEXT NOT NULL,
    "detected_by_run_id" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "promoted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payer_requirement_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enrollment_outcomes_payer_id_idx" ON "enrollment_outcomes"("payer_id");

-- CreateIndex
CREATE INDEX "enrollment_outcomes_state_idx" ON "enrollment_outcomes"("state");

-- CreateIndex
CREATE INDEX "enrollment_outcomes_outcome_idx" ON "enrollment_outcomes"("outcome");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_outcomes_enrollment_id_outcome_key" ON "enrollment_outcomes"("enrollment_id", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "crawl_sources_url_key" ON "crawl_sources"("url");

-- CreateIndex
CREATE INDEX "crawl_snapshots_crawl_source_id_idx" ON "crawl_snapshots"("crawl_source_id");

-- CreateIndex
CREATE INDEX "payer_requirement_changes_payer_track_id_idx" ON "payer_requirement_changes"("payer_track_id");

-- CreateIndex
CREATE INDEX "payer_requirement_changes_verified_idx" ON "payer_requirement_changes"("verified");

-- CreateIndex
CREATE UNIQUE INDEX "payer_timelines_payer_track_id_process_type_key" ON "payer_timelines"("payer_track_id", "process_type");

-- CreateIndex
CREATE UNIQUE INDEX "payer_state_rules_payer_track_id_state_rule_type_key" ON "payer_state_rules"("payer_track_id", "state", "rule_type");

-- CreateIndex
CREATE UNIQUE INDEX "payer_forms_payer_track_id_form_name_key" ON "payer_forms"("payer_track_id", "form_name");

-- CreateIndex
CREATE UNIQUE INDEX "payer_requirements_payer_track_id_name_override_type_key" ON "payer_requirements"("payer_track_id", "name", "override_type");

-- AddForeignKey
ALTER TABLE "enrollment_outcomes" ADD CONSTRAINT "enrollment_outcomes_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "payer_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawl_sources" ADD CONSTRAINT "crawl_sources_payer_track_id_fkey" FOREIGN KEY ("payer_track_id") REFERENCES "payer_tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawl_snapshots" ADD CONSTRAINT "crawl_snapshots_crawl_source_id_fkey" FOREIGN KEY ("crawl_source_id") REFERENCES "crawl_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_requirement_changes" ADD CONSTRAINT "payer_requirement_changes_payer_track_id_fkey" FOREIGN KEY ("payer_track_id") REFERENCES "payer_tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────────
-- BACKFILL (data, not schema — Prisma's diff cannot infer these)
-- ──────────────────────────────────────────────────────────────────────────

-- Existing curated rows are human-curated (origin default already applied by
-- ADD COLUMN) and trusted: stamp them verified + captured_at = now.
UPDATE "payer_requirements" SET "verified" = true, "captured_at" = CURRENT_TIMESTAMP;
UPDATE "payer_state_rules"  SET "verified" = true, "captured_at" = CURRENT_TIMESTAMP;
UPDATE "payer_timelines"    SET "verified" = true, "captured_at" = CURRENT_TIMESTAMP;
UPDATE "payer_forms"        SET "verified" = true, "captured_at" = CURRENT_TIMESTAMP;

-- Carry the existing free-text `source` into source_url where it is a URL
-- (only payer_requirements has a `source` column; left in place alongside).
UPDATE "payer_requirements"
SET "source_url" = "source"
WHERE "source" IS NOT NULL AND "source" ~* '^https?://';

-- Flag the seeded demo practice so its enrollments never enter `enrollment_outcomes`.
-- Specific match on the known seed name only — beta testers are told to use
-- "Test ..." names, so we must NOT broadly exclude on "test"/"demo".
UPDATE "practices" SET "is_demo" = true WHERE lower("name") LIKE '%lanyard demo%';

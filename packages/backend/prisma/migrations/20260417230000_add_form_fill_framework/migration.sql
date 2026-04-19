-- AlterTable
ALTER TABLE "payer_forms"
    ADD COLUMN "delivery_engine" TEXT,
    ADD COLUMN "asset_url" TEXT;

-- CreateTable
CREATE TABLE "payer_form_fields" (
    "id" TEXT NOT NULL,
    "payer_form_id" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "field_label" TEXT NOT NULL,
    "field_type" TEXT NOT NULL,
    "page_section" TEXT,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "validation_regex" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payer_form_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payer_form_fields_payer_form_id_field_key_key" ON "payer_form_fields"("payer_form_id", "field_key");

-- CreateIndex
CREATE INDEX "payer_form_fields_payer_form_id_idx" ON "payer_form_fields"("payer_form_id");

-- AddForeignKey
ALTER TABLE "payer_form_fields" ADD CONSTRAINT "payer_form_fields_payer_form_id_fkey" FOREIGN KEY ("payer_form_id") REFERENCES "payer_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "payer_form_field_mappings" (
    "id" TEXT NOT NULL,
    "payer_form_field_id" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL,
    "source_path" TEXT NOT NULL,
    "transform" JSONB,
    "fallback_value" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payer_form_field_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payer_form_field_mappings_payer_form_field_id_idx" ON "payer_form_field_mappings"("payer_form_field_id");

-- AddForeignKey
ALTER TABLE "payer_form_field_mappings" ADD CONSTRAINT "payer_form_field_mappings_payer_form_field_id_fkey" FOREIGN KEY ("payer_form_field_id") REFERENCES "payer_form_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "enrollment_runs" (
    "id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "filled_artifacts" JSONB,
    "error_details" JSONB,
    "triggered_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enrollment_runs_enrollment_id_idx" ON "enrollment_runs"("enrollment_id");

-- CreateIndex
CREATE INDEX "enrollment_runs_status_idx" ON "enrollment_runs"("status");

-- AddForeignKey
ALTER TABLE "enrollment_runs" ADD CONSTRAINT "enrollment_runs_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "payer_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

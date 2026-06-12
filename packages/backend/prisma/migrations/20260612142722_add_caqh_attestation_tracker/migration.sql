-- AlterTable
ALTER TABLE "practice_settings" ADD COLUMN     "caqh_reminders_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "caqh_attestation_trackers" (
    "id" TEXT NOT NULL,
    "provider_profile_id" TEXT NOT NULL,
    "last_attestation_date" TIMESTAMP(3),
    "next_due_date" TIMESTAMP(3),
    "provider_status" TEXT,
    "baseline_snapshot" JSONB,
    "baseline_captured_at" TIMESTAMP(3),
    "diff_verdict" TEXT NOT NULL DEFAULT 'no_baseline',
    "changed_sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reminders_sent" JSONB,
    "cycle_anchor" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "caqh_attestation_trackers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "caqh_attestation_trackers_provider_profile_id_key" ON "caqh_attestation_trackers"("provider_profile_id");

-- AddForeignKey
ALTER TABLE "caqh_attestation_trackers" ADD CONSTRAINT "caqh_attestation_trackers_provider_profile_id_fkey" FOREIGN KEY ("provider_profile_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


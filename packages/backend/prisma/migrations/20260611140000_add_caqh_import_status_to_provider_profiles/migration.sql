-- CAQH-first onboarding PR 2: import job state machine on the provider profile.
CREATE TYPE "CaqhImportStatus" AS ENUM ('queued', 'in_progress', 'waiting_authorization', 'waiting_attestation', 'completed', 'failed');

ALTER TABLE "providers" ADD COLUMN "caqh_import_status" "CaqhImportStatus";
ALTER TABLE "providers" ADD COLUMN "caqh_import_error" TEXT;
ALTER TABLE "providers" ADD COLUMN "caqh_import_updated_at" TIMESTAMP(3);

-- Admin alert when an import has been stuck waiting on provider action for two weeks
ALTER TYPE "InAppNotificationType" ADD VALUE 'caqh_import_stalled';

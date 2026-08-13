-- Second-factor enrollment tracking.
--
-- Additive only: both columns have safe defaults, so existing rows are valid the
-- moment this runs and a rollback is a plain DROP COLUMN with nothing to restore.
ALTER TABLE "users" ADD COLUMN "mfa_skips_used" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "mfa_enrolled_at" TIMESTAMP(3);

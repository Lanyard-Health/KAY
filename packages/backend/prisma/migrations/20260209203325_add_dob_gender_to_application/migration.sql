-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "NotificationType" ADD VALUE 'application_submitted';
ALTER TYPE "NotificationType" ADD VALUE 'application_approved';

-- AlterTable: Add columns with defaults for existing rows, then remove defaults
ALTER TABLE "provider_applications" ADD COLUMN "date_of_birth" TIMESTAMP(3);
ALTER TABLE "provider_applications" ADD COLUMN "gender" "Gender";

-- Backfill existing rows with placeholder values
UPDATE "provider_applications" SET "date_of_birth" = '1900-01-01T00:00:00.000Z' WHERE "date_of_birth" IS NULL;
UPDATE "provider_applications" SET "gender" = 'prefer_not_to_say' WHERE "gender" IS NULL;

-- Make columns required
ALTER TABLE "provider_applications" ALTER COLUMN "date_of_birth" SET NOT NULL;
ALTER TABLE "provider_applications" ALTER COLUMN "gender" SET NOT NULL;

-- AlterTable
ALTER TABLE "payer_enrollments" ADD COLUMN     "pdm_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pdm_last_attested_at" TIMESTAMP(3),
ADD COLUMN     "pdm_last_attested_by" TEXT;

-- AlterTable
ALTER TABLE "practice_locations" ADD COLUMN     "last_directory_update_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "last_directory_update_at" TIMESTAMP(3);

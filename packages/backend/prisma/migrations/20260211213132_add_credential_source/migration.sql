-- CreateEnum
CREATE TYPE "CredentialSource" AS ENUM ('manual_entry', 'caqh_sync', 'portal_import');

-- AlterTable
ALTER TABLE "board_certifications" ADD COLUMN     "source" "CredentialSource" NOT NULL DEFAULT 'manual_entry';

-- AlterTable
ALTER TABLE "licenses" ADD COLUMN     "source" "CredentialSource" NOT NULL DEFAULT 'manual_entry';

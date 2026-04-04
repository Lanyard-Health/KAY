/*
  Warnings:

  - The values [ops_staff] on the enum `UserRole` will be removed. If these variants are still used in the database, this will fail.
  - Made the column `embedding` on table `knowledge_base_embeddings` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('lanyard_admin', 'admin', 'credentialing_staff', 'provider', 'practice_admin');
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";
COMMIT;

-- AlterTable
ALTER TABLE "knowledge_base_embeddings" ALTER COLUMN "embedding" SET NOT NULL;

-- AlterTable
ALTER TABLE "practices" ADD COLUMN     "max_provider_slots" INTEGER,
ADD COLUMN     "max_user_seats" INTEGER,
ADD COLUMN     "organization_type" TEXT;

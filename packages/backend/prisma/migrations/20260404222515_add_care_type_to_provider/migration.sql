-- CreateEnum
CREATE TYPE "CareType" AS ENUM ('in_person', 'hybrid', 'virtual', 'in_home', 'other');

-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "care_type" "CareType";

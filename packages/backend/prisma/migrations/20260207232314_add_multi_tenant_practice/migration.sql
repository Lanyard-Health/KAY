-- CreateEnum
CREATE TYPE "PracticeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PracticeRole" AS ENUM ('SUPER_ADMIN', 'PRACTICE_ADMIN', 'PRACTICE_STAFF', 'PROVIDER');

-- AlterTable
ALTER TABLE "practice_locations" ADD COLUMN     "practice_id" TEXT;

-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "practice_id" TEXT;

-- CreateTable
CREATE TABLE "practices" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PracticeStatus" NOT NULL DEFAULT 'ACTIVE',
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_practices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "role" "PracticeRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_practices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_practices_practice_id_idx" ON "user_practices"("practice_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_practices_user_id_practice_id_key" ON "user_practices"("user_id", "practice_id");

-- AddForeignKey
ALTER TABLE "user_practices" ADD CONSTRAINT "user_practices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_practices" ADD CONSTRAINT "user_practices_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "providers" ADD CONSTRAINT "providers_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_locations" ADD CONSTRAINT "practice_locations_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

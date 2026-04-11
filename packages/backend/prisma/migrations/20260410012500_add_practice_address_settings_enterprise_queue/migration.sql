-- CreateEnum
CREATE TYPE "EnterpriseQueueStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- AlterTable
ALTER TABLE "practices" ADD COLUMN     "address_line_1" TEXT,
ADD COLUMN     "address_line_2" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "zip_code" TEXT;

-- CreateTable
CREATE TABLE "practice_settings" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "enrollment_cap" INTEGER,
    "follow_up_submissions" BOOLEAN NOT NULL DEFAULT true,
    "follow_up_denial_triage" BOOLEAN NOT NULL DEFAULT true,
    "multiple_locations" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_queue" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "status" "EnterpriseQueueStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprise_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "practice_settings_practice_id_key" ON "practice_settings"("practice_id");

-- CreateIndex
CREATE INDEX "enterprise_queue_practice_id_idx" ON "enterprise_queue"("practice_id");

-- AddForeignKey
ALTER TABLE "practice_settings" ADD CONSTRAINT "practice_settings_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_queue" ADD CONSTRAINT "enterprise_queue_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

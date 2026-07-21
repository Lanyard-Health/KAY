-- CreateEnum
CREATE TYPE "TaskGroup" AS ENUM ('FOLLOW_UP', 'CALL_BACK', 'SUBMIT_APPLICATION', 'REQUEST_DOCUMENTS', 'CAQH_UPDATE', 'VERIFY_INFORMATION', 'ESCALATION', 'OTHER', 'CHECK_IN');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "overdue_reason" TEXT,
ADD COLUMN     "overdue_reason_at" TIMESTAMP(3),
ADD COLUMN     "payer_id" TEXT,
ADD COLUMN     "task_group" "TaskGroup";

-- CreateTable
CREATE TABLE "payer_contact_infos" (
    "id" TEXT NOT NULL,
    "payer_id" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "best_way" TEXT,
    "hours" TEXT,
    "notes" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payer_contact_infos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payer_contact_infos_payer_id_key" ON "payer_contact_infos"("payer_id");

-- CreateIndex
CREATE INDEX "tasks_payer_id_idx" ON "tasks"("payer_id");

-- CreateIndex
CREATE INDEX "tasks_task_group_idx" ON "tasks"("task_group");

-- AddForeignKey
ALTER TABLE "payer_contact_infos" ADD CONSTRAINT "payer_contact_infos_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_contact_infos" ADD CONSTRAINT "payer_contact_infos_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

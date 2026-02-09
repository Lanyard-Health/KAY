-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('TERMINATE_ENROLLMENT', 'CHECK_AVAILITY', 'UPDATE_CAQH', 'DRAFT_TERM_LETTER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TerminationLetterStatus" AS ENUM ('DRAFT', 'REVIEWED', 'SENT');

-- AlterTable: Add groupNpi to practice_locations
ALTER TABLE "practice_locations" ADD COLUMN "group_npi" TEXT;

-- AlterTable: Add payerEmail to payer_enrollments
ALTER TABLE "payer_enrollments" ADD COLUMN "payer_email" TEXT;

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "enrollment_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "TaskType" NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "assigned_to_id" TEXT,
    "due_date" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "completed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "termination_letters" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "payer_name" TEXT NOT NULL,
    "payer_email" TEXT,
    "provider_name" TEXT NOT NULL,
    "npi" TEXT NOT NULL,
    "group_npi" TEXT,
    "tax_id" TEXT NOT NULL,
    "letter_content" TEXT NOT NULL,
    "status" "TerminationLetterStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "termination_letters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_provider_id_idx" ON "tasks"("provider_id");

-- CreateIndex
CREATE INDEX "tasks_enrollment_id_idx" ON "tasks"("enrollment_id");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE INDEX "tasks_type_idx" ON "tasks"("type");

-- CreateIndex
CREATE INDEX "termination_letters_provider_id_idx" ON "termination_letters"("provider_id");

-- CreateIndex
CREATE INDEX "termination_letters_task_id_idx" ON "termination_letters"("task_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "payer_enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "termination_letters" ADD CONSTRAINT "termination_letters_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "termination_letters" ADD CONSTRAINT "termination_letters_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "termination_letters" ADD CONSTRAINT "termination_letters_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

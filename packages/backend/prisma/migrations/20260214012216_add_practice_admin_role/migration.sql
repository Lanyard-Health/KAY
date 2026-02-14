-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'practice_admin';

-- RenameIndex
ALTER INDEX "enrollment_workflow_steps_enrollment_order_idx" RENAME TO "enrollment_workflow_steps_enrollment_id_step_order_idx";

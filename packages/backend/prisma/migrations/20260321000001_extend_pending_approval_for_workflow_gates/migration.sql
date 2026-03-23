-- AlterTable: Make workflowId, taskId, expiresAt optional on PendingApproval
ALTER TABLE "pending_approvals" ALTER COLUMN "workflow_id" DROP NOT NULL;
ALTER TABLE "pending_approvals" ALTER COLUMN "task_id" DROP NOT NULL;
ALTER TABLE "pending_approvals" ALTER COLUMN "expires_at" DROP NOT NULL;

-- AddColumn: enrollment workflow step approval
ALTER TABLE "pending_approvals" ADD COLUMN "enrollment_workflow_step_id" TEXT;

-- AddColumn: follow-up outreach approval
ALTER TABLE "pending_approvals" ADD COLUMN "follow_up_run_id" TEXT;
ALTER TABLE "pending_approvals" ADD COLUMN "follow_up_step_order" INTEGER;

-- AddForeignKey
ALTER TABLE "pending_approvals" ADD CONSTRAINT "pending_approvals_enrollment_workflow_step_id_fkey" FOREIGN KEY ("enrollment_workflow_step_id") REFERENCES "enrollment_workflow_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_approvals" ADD CONSTRAINT "pending_approvals_follow_up_run_id_fkey" FOREIGN KEY ("follow_up_run_id") REFERENCES "follow_up_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "pending_approvals_enrollment_workflow_step_id_idx" ON "pending_approvals"("enrollment_workflow_step_id");

-- CreateIndex
CREATE INDEX "pending_approvals_follow_up_run_id_idx" ON "pending_approvals"("follow_up_run_id");

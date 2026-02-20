-- CreateEnum
CREATE TYPE "AgentWorkflowStatus" AS ENUM ('planning', 'active', 'paused', 'waiting_approval', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "AgentTaskStatus" AS ENUM ('pending', 'queued', 'in_progress', 'completed', 'failed', 'skipped', 'cancelled');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'denied', 'expired');

-- CreateTable
CREATE TABLE "agent_workflows" (
    "id" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "goal_params" JSONB NOT NULL,
    "status" "AgentWorkflowStatus" NOT NULL DEFAULT 'planning',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "plan" JSONB,
    "provider_id" TEXT NOT NULL,
    "payer_id" TEXT,
    "enrollment_id" TEXT,
    "requested_by" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "total_tokens_used" INTEGER NOT NULL DEFAULT 0,
    "total_duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tasks" (
    "id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "agent_type" TEXT NOT NULL,
    "status" "AgentTaskStatus" NOT NULL DEFAULT 'pending',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" JSONB,
    "step_number" INTEGER NOT NULL,
    "depends_on" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "bullmq_job_id" TEXT,
    "queue" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "queued_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "tokens_used" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_events" (
    "id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "task_id" TEXT,
    "agent" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_approvals" (
    "id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "context" JSONB NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_notes" TEXT,

    CONSTRAINT "pending_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payer_adapter_configs" (
    "id" TEXT NOT NULL,
    "payer_id" TEXT NOT NULL,
    "adapter_type" TEXT NOT NULL,
    "submission_method" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "credentials" JSONB,
    "required_fields" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_tested_at" TIMESTAMP(3),
    "last_test_result" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payer_adapter_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_workflows_status_idx" ON "agent_workflows"("status");

-- CreateIndex
CREATE INDEX "agent_workflows_provider_id_idx" ON "agent_workflows"("provider_id");

-- CreateIndex
CREATE INDEX "agent_workflows_requested_by_idx" ON "agent_workflows"("requested_by");

-- CreateIndex
CREATE INDEX "agent_tasks_workflow_id_status_idx" ON "agent_tasks"("workflow_id", "status");

-- CreateIndex
CREATE INDEX "agent_tasks_agent_type_status_idx" ON "agent_tasks"("agent_type", "status");

-- CreateIndex
CREATE INDEX "agent_tasks_bullmq_job_id_idx" ON "agent_tasks"("bullmq_job_id");

-- CreateIndex
CREATE INDEX "agent_events_workflow_id_timestamp_idx" ON "agent_events"("workflow_id", "timestamp");

-- CreateIndex
CREATE INDEX "agent_events_agent_action_idx" ON "agent_events"("agent", "action");

-- CreateIndex
CREATE INDEX "pending_approvals_status_idx" ON "pending_approvals"("status");

-- CreateIndex
CREATE INDEX "pending_approvals_workflow_id_idx" ON "pending_approvals"("workflow_id");

-- CreateIndex
CREATE UNIQUE INDEX "payer_adapter_configs_payer_id_key" ON "payer_adapter_configs"("payer_id");

-- AddForeignKey
ALTER TABLE "agent_workflows" ADD CONSTRAINT "agent_workflows_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_workflows" ADD CONSTRAINT "agent_workflows_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_workflows" ADD CONSTRAINT "agent_workflows_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "agent_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "agent_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_approvals" ADD CONSTRAINT "pending_approvals_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "agent_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_approvals" ADD CONSTRAINT "pending_approvals_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_adapter_configs" ADD CONSTRAINT "payer_adapter_configs_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

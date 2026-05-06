-- CreateTable
CREATE TABLE "agent_actions" (
    "id" TEXT NOT NULL,
    "workflow_id" TEXT,
    "task_id" TEXT,
    "practice_id" TEXT,
    "provider_id" TEXT,
    "agent_name" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error_category" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_cents" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_actions_agent_name_created_at_idx" ON "agent_actions"("agent_name", "created_at");

-- CreateIndex
CREATE INDEX "agent_actions_practice_id_created_at_idx" ON "agent_actions"("practice_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_actions_provider_id_created_at_idx" ON "agent_actions"("provider_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_actions_workflow_id_idx" ON "agent_actions"("workflow_id");

-- AddForeignKey
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "agent_workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

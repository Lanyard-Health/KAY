-- Tier 2 #9 — Idempotency for agent task dispatch.
-- Adds an optional dedupeKey to AgentTask. Callers compute a SHA-256 over
-- (workflowId, type, JSON.stringify(input)) by default, but may pass an
-- explicit key. The unique constraint (workflowId, dedupeKey) makes a second
-- dispatch with the same key a no-op that returns the existing row.
-- NULL is allowed so existing pre-migration rows don't violate the unique.

ALTER TABLE "agent_tasks" ADD COLUMN "dedupe_key" TEXT;

CREATE UNIQUE INDEX "agent_tasks_workflow_id_dedupe_key_key"
  ON "agent_tasks" ("workflow_id", "dedupe_key");

-- Promote replanCount from plan JSON to a top-level Int column so the
-- orchestrator can use an atomic SQL UPDATE (replan_count = replan_count + 1)
-- and close the read-modify-write race that exists when callbacks for the same
-- workflow run on different worker slots (concurrency=3).
--
-- Additive migration: adds the column with a default of 0 (PG11+ adds the
-- DEFAULT in the catalog only — no full table rewrite). Then backfills from
-- the existing plan->>'replanCount' JSON path so live workflows keep their
-- count when this deploys.

ALTER TABLE "agent_workflows" ADD COLUMN "replan_count" INTEGER NOT NULL DEFAULT 0;

-- Idempotent backfill: COALESCE handles plan rows missing the replanCount key.
-- Rows where plan IS NULL keep the column default (0) — they have not replanned yet.
UPDATE "agent_workflows"
   SET "replan_count" = COALESCE(("plan"->>'replanCount')::int, 0)
 WHERE "plan" IS NOT NULL;

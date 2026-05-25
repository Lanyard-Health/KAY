-- Phase 6 cleanup of payer-workflows.json → DB migration.
-- All 5 payers (Aetna, Cigna/Evernorth, UHC, Optum, Humana) now have DB-backed
-- WorkflowTemplate rows. Path B (JSON hydration keyed by Payer.workflow_key) is
-- fully retired in this PR, so the workflow_key column on payers is no longer
-- referenced by any application code and is safe to drop.
--
-- IRREVERSIBLE without a backup restore. Run only after the prior 5 per-payer
-- PRs have shipped and been verified in production.
ALTER TABLE "payers" DROP COLUMN "workflow_key";

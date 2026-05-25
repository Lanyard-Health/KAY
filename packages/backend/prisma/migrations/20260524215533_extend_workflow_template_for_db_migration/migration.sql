-- Extend WorkflowTemplateStep with fields needed to migrate payer-workflows.json into the DB
-- (per-step URL, day ranges, warnings, possible outcomes, action type for UI rendering, and a
-- catch-all metadata blob for payer-specific structured extras).
-- All additions are nullable / default empty so existing WorkflowTemplateStep rows stay valid.
-- AlterTable
ALTER TABLE "workflow_template_steps"
  ADD COLUMN "url"                TEXT,
  ADD COLUMN "estimated_days_min" INTEGER,
  ADD COLUMN "estimated_days_max" INTEGER,
  ADD COLUMN "warnings"           TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "possible_outcomes"  TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "action_type"        TEXT,
  ADD COLUMN "metadata"           JSONB;

-- Extend WorkflowTemplateCondition with array form of conditionValue, used for IN-list matching
-- (e.g. state IN [IN, KY, MI, OH, OK, VA, WV]). conditionValue (singular) is retained so existing
-- rows + the existing seed pattern continue to work; seeds populating an IN-list should set
-- conditionValue to the first array entry for backward-compat readers and conditionValues to the full list.
-- AlterTable
ALTER TABLE "workflow_template_conditions"
  ADD COLUMN "condition_values" TEXT[] DEFAULT ARRAY[]::TEXT[];

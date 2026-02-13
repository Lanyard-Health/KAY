-- Fix: Narrow workflow_key assignment to only top-level payers
-- Previously used LIKE patterns which matched 171 sub-plan payers

-- Clear all broad LIKE-matched keys
UPDATE "payers" SET "workflow_key" = NULL WHERE "workflow_key" IS NOT NULL;

-- Assign only to exact top-level payer names
UPDATE "payers" SET "workflow_key" = 'aetna' WHERE "name" = 'Aetna';
UPDATE "payers" SET "workflow_key" = 'cigna' WHERE "name" = 'Cigna';
UPDATE "payers" SET "workflow_key" = 'uhc' WHERE "name" = 'UnitedHealthcare';
UPDATE "payers" SET "workflow_key" = 'optum' WHERE "name" = 'Optum';
UPDATE "payers" SET "workflow_key" = 'humana' WHERE "name" = 'Humana';

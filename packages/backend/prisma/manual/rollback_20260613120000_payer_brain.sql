-- ROLLBACK for migration 20260613120000_payer_brain_outcomes_provenance
-- Run as kay_staging_user via DATABASE_URL_ADMIN. Drops everything the migration
-- added. (The codebase has no Prisma down-migration convention; this is the
-- "down" the apply steps reference. Prefer a Render snapshot restore if the
-- migration half-applied and left the DB inconsistent.)
--
-- Order: drop FK-dependent + enum-using tables first, then enum-using columns,
-- then the enum types, then the _prisma_migrations bookkeeping row.

DROP TABLE IF EXISTS "payer_requirement_changes";
DROP TABLE IF EXISTS "crawl_snapshots";
DROP TABLE IF EXISTS "crawl_sources";
DROP TABLE IF EXISTS "enrollment_outcomes";

DROP INDEX IF EXISTS "payer_requirements_payer_track_id_name_override_type_key";
DROP INDEX IF EXISTS "payer_forms_payer_track_id_form_name_key";
DROP INDEX IF EXISTS "payer_state_rules_payer_track_id_state_rule_type_key";
DROP INDEX IF EXISTS "payer_timelines_payer_track_id_process_type_key";

ALTER TABLE "payer_requirements"
  DROP COLUMN IF EXISTS "origin",
  DROP COLUMN IF EXISTS "source_url",
  DROP COLUMN IF EXISTS "captured_at",
  DROP COLUMN IF EXISTS "content_hash",
  DROP COLUMN IF EXISTS "verified";
ALTER TABLE "payer_state_rules"
  DROP COLUMN IF EXISTS "origin",
  DROP COLUMN IF EXISTS "source_url",
  DROP COLUMN IF EXISTS "captured_at",
  DROP COLUMN IF EXISTS "content_hash",
  DROP COLUMN IF EXISTS "verified";
ALTER TABLE "payer_timelines"
  DROP COLUMN IF EXISTS "origin",
  DROP COLUMN IF EXISTS "source_url",
  DROP COLUMN IF EXISTS "captured_at",
  DROP COLUMN IF EXISTS "content_hash",
  DROP COLUMN IF EXISTS "verified";
ALTER TABLE "payer_forms"
  DROP COLUMN IF EXISTS "origin",
  DROP COLUMN IF EXISTS "source_url",
  DROP COLUMN IF EXISTS "captured_at",
  DROP COLUMN IF EXISTS "content_hash",
  DROP COLUMN IF EXISTS "verified";
ALTER TABLE "practices" DROP COLUMN IF EXISTS "is_demo";

DROP TYPE IF EXISTS "EnrollmentOutcomeType";
DROP TYPE IF EXISTS "PayerDataOrigin";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20260613120000_payer_brain_outcomes_provenance';

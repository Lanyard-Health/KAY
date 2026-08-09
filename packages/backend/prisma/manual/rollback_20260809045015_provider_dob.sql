-- Rollback for 20260809045015_provider_dob_encrypted (Phase 1).
--
-- Run as the admin role via DATABASE_URL_ADMIN:
--   psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 \
--     -f prisma/manual/rollback_20260809045015_provider_dob.sql
--
-- Safe ONLY while the encrypted columns are empty — i.e. before the Phase 3
-- backfill. After Phase 4 clears plaintext, the encrypted column is the only
-- copy of every date of birth and dropping it is unrecoverable. The guard below
-- aborts rather than trusting whoever runs this to remember which phase we are in.

BEGIN;

DO $$
DECLARE
  n_providers   bigint;
  n_apps        bigint;
BEGIN
  SELECT count(*) INTO n_providers
    FROM providers WHERE date_of_birth_encrypted IS NOT NULL;
  SELECT count(*) INTO n_apps
    FROM provider_applications WHERE date_of_birth_encrypted IS NOT NULL;

  IF n_providers > 0 OR n_apps > 0 THEN
    RAISE EXCEPTION
      'REFUSING TO ROLLBACK: date_of_birth_encrypted holds data (providers=%, provider_applications=%). Dropping it would destroy the only copy. Restore from snapshot instead.',
      n_providers, n_apps;
  END IF;
END $$;

ALTER TABLE "providers" DROP COLUMN IF EXISTS "date_of_birth_encrypted";
ALTER TABLE "provider_applications" DROP COLUMN IF EXISTS "date_of_birth_encrypted";

-- Restore NOT NULL only if it can be restored. Rows created while the column was
-- nullable would block it; leaving it nullable is harmless and reversible, an
-- aborted rollback is not.
DO $$
DECLARE
  n_null bigint;
BEGIN
  SELECT count(*) INTO n_null
    FROM provider_applications WHERE date_of_birth IS NULL;

  IF n_null = 0 THEN
    ALTER TABLE "provider_applications" ALTER COLUMN "date_of_birth" SET NOT NULL;
  ELSE
    RAISE NOTICE
      'Leaving provider_applications.date_of_birth nullable: % row(s) are NULL.', n_null;
  END IF;
END $$;

DELETE FROM "_prisma_migrations"
  WHERE migration_name = '20260809045015_provider_dob_encrypted';

COMMIT;

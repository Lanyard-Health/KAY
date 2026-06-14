-- lanyard_crawler — least-privilege role for the payer-brain watcher (Phase C).
--
-- Run as kay_staging_user (the table owner) via DATABASE_URL_ADMIN, AFTER the
-- 20260613120000_payer_brain migration has applied (the crawl tables must exist).
--
-- This role may write ONLY the crawl-side tables. It is granted NOTHING on the
-- curated payer_* tables, so any INSERT/UPDATE there raises 42501. This is what
-- makes overwrite-contract rule #1 (write isolation) enforced by the database,
-- not just by application code. The crawler must connect as THIS role — never as
-- lanyard_app (which already has write access to the curated tables).
--
-- The password is intentionally NOT set here (never commit secrets). Set it in a
-- separate step — see PHASE_B_APPLY_STEPS.md (psql \password or ALTER ROLE with a
-- value read from a /tmp file).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lanyard_crawler') THEN
    CREATE ROLE lanyard_crawler WITH LOGIN;
  END IF;
END
$$;

-- See the schema (required to reference any table).
GRANT USAGE ON SCHEMA public TO lanyard_crawler;

-- Write access to the crawl-side tables ONLY.
GRANT SELECT, INSERT, UPDATE ON "crawl_sources"             TO lanyard_crawler;
GRANT SELECT, INSERT, UPDATE ON "crawl_snapshots"           TO lanyard_crawler;
GRANT SELECT, INSERT, UPDATE ON "payer_requirement_changes" TO lanyard_crawler;

-- Belt-and-suspenders: explicitly ensure ZERO access to the curated tables and
-- the outcomes asset. (Owner-by-kay_staging_user means these are already denied;
-- the REVOKE makes intent explicit and survives any future blanket GRANT.)
REVOKE ALL ON "payer_requirements" FROM lanyard_crawler;
REVOKE ALL ON "payer_state_rules"  FROM lanyard_crawler;
REVOKE ALL ON "payer_timelines"    FROM lanyard_crawler;
REVOKE ALL ON "payer_forms"        FROM lanyard_crawler;
REVOKE ALL ON "payer_tracks"       FROM lanyard_crawler;
REVOKE ALL ON "enrollment_outcomes" FROM lanyard_crawler;

-- Do NOT grant any future default privileges to this role.

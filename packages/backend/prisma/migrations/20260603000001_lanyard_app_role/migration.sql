-- lanyard_app role: a restricted Postgres role the application connects as
-- in production. Full CRUD on every table EXCEPT audit_logs, where it has
-- INSERT/SELECT only (UPDATE/DELETE/TRUNCATE revoked). Combined with the
-- audit_logs_block_mutation trigger from the prior migration, this gives
-- two independent layers preventing audit tampering.
--
-- Operator step (post-deploy): update Render env var DATABASE_URL on both
-- kay-backend (prod) and kay-backend-staging to use this role's credentials.
-- Old superuser DATABASE_URL stays as DATABASE_URL_ADMIN for future
-- migrations and one-off cleanup.
--
-- Password is set out-of-band (psql or Render console). This migration
-- intentionally creates the role with no password so secrets stay out of
-- version control. The role can't login until a password is set.
--
-- Phase 3b of the submission engine plan.

-- Idempotent role creation: only create if it doesn't already exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lanyard_app') THEN
    CREATE ROLE lanyard_app WITH LOGIN;
  END IF;
END
$$;

-- GRANT CONNECT needs the current database name resolved dynamically.
DO $$
DECLARE
  db_name TEXT := current_database();
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO lanyard_app', db_name);
END
$$;

-- Schema-level access
GRANT USAGE ON SCHEMA public TO lanyard_app;

-- Default DML on all existing tables (audit_logs gets refined below)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lanyard_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lanyard_app;

-- Tighten audit_logs: INSERT + SELECT only. UPDATE/DELETE/TRUNCATE blocked.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM lanyard_app;

-- Future tables created after this migration get the same defaults
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lanyard_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO lanyard_app;

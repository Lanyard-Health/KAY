-- audit_logs immutability: BEFORE UPDATE/DELETE triggers raise an exception so
-- the table is append-only at the Postgres layer. Application code already
-- never UPDATEs/DELETEs audit_logs (only INSERTs via audit.service.ts), but
-- this trigger is belt-and-suspenders for SOC 2 — any code path that ever
-- tried to mutate audit rows would fail loudly instead of silently corrupting
-- the audit history.
--
-- Phase 3b of the submission engine plan.

-- Function: raises an exception with a clear message and the operation type.
CREATE OR REPLACE FUNCTION audit_logs_block_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only — % blocked by trigger', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

-- Idempotent re-creation: drop existing triggers first.
DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();

CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();

-- Note: TRUNCATE bypasses BEFORE DELETE row triggers in Postgres. The
-- companion role migration (20260603000001_lanyard_app_role) revokes
-- TRUNCATE from the application role to close that gap. Superuser sessions
-- (used for migrations/cleanup) can still TRUNCATE.

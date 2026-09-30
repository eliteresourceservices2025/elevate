-- Employment history is append-only: who held which position and when must not be rewritable.
-- Same approach as ops.audit_log: triggers refuse changes even from the owner role.
CREATE OR REPLACE FUNCTION core.reject_history_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'core.employment_history is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER employment_history_no_update_delete
  BEFORE UPDATE OR DELETE ON core.employment_history
  FOR EACH ROW EXECUTE FUNCTION core.reject_history_change();
--> statement-breakpoint
CREATE TRIGGER employment_history_no_truncate
  BEFORE TRUNCATE ON core.employment_history
  FOR EACH STATEMENT EXECUTE FUNCTION core.reject_history_change();

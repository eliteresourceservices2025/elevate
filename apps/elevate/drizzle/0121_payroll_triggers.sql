-- Payroll protections, in the database so they hold even with direct access.
-- 1. Append-only tables. A change is a new row.
-- 2. A run's lines and items freeze once the run leaves draft.
-- 3. A run's status moves only along the allowed path, and its rate and snapshot change only in draft.
-- Functions take no user input and run with an empty search_path.

CREATE OR REPLACE FUNCTION payroll.reject_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pay_settings_append_only BEFORE UPDATE OR DELETE ON payroll.pay_settings FOR EACH ROW EXECUTE FUNCTION payroll.reject_change();
--> statement-breakpoint
CREATE TRIGGER pay_settings_no_truncate BEFORE TRUNCATE ON payroll.pay_settings FOR EACH STATEMENT EXECUTE FUNCTION payroll.reject_change();
--> statement-breakpoint
CREATE TRIGGER pay_lines_append_only BEFORE UPDATE OR DELETE ON payroll.pay_lines FOR EACH ROW EXECUTE FUNCTION payroll.reject_change();
--> statement-breakpoint
CREATE TRIGGER pay_lines_no_truncate BEFORE TRUNCATE ON payroll.pay_lines FOR EACH STATEMENT EXECUTE FUNCTION payroll.reject_change();
--> statement-breakpoint
CREATE TRIGGER pay_run_items_append_only BEFORE UPDATE OR DELETE ON payroll.pay_run_items FOR EACH ROW EXECUTE FUNCTION payroll.reject_change();
--> statement-breakpoint
CREATE TRIGGER pay_run_items_no_truncate BEFORE TRUNCATE ON payroll.pay_run_items FOR EACH STATEMENT EXECUTE FUNCTION payroll.reject_change();
--> statement-breakpoint
CREATE TRIGGER pay_approvals_append_only BEFORE UPDATE OR DELETE ON payroll.pay_approvals FOR EACH ROW EXECUTE FUNCTION payroll.reject_change();
--> statement-breakpoint
CREATE TRIGGER pay_approvals_no_truncate BEFORE TRUNCATE ON payroll.pay_approvals FOR EACH STATEMENT EXECUTE FUNCTION payroll.reject_change();
--> statement-breakpoint
CREATE TRIGGER pay_payments_append_only BEFORE UPDATE OR DELETE ON payroll.pay_payments FOR EACH ROW EXECUTE FUNCTION payroll.reject_change();
--> statement-breakpoint
CREATE TRIGGER pay_payments_no_truncate BEFORE TRUNCATE ON payroll.pay_payments FOR EACH STATEMENT EXECUTE FUNCTION payroll.reject_change();
--> statement-breakpoint
CREATE TRIGGER pay_change_log_append_only BEFORE UPDATE OR DELETE ON payroll.pay_change_log FOR EACH ROW EXECUTE FUNCTION payroll.reject_change();
--> statement-breakpoint
CREATE TRIGGER pay_change_log_no_truncate BEFORE TRUNCATE ON payroll.pay_change_log FOR EACH STATEMENT EXECUTE FUNCTION payroll.reject_change();
--> statement-breakpoint
-- Lines and items of a run that is no longer a draft are frozen: no edits, no removals, nothing new.
CREATE OR REPLACE FUNCTION payroll.reject_frozen_run_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  run_status text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO run_status FROM payroll.pay_runs WHERE id = OLD.run_id;
    IF run_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'The run is % and its lines and items are frozen', run_status;
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO run_status FROM payroll.pay_runs WHERE id = NEW.run_id;
    IF run_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'The run is % and its lines and items are frozen', run_status;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pay_run_lines_freeze BEFORE INSERT OR UPDATE OR DELETE ON payroll.pay_run_lines FOR EACH ROW EXECUTE FUNCTION payroll.reject_frozen_run_change();
--> statement-breakpoint
CREATE TRIGGER pay_run_items_freeze BEFORE INSERT ON payroll.pay_run_items FOR EACH ROW EXECUTE FUNCTION payroll.reject_frozen_run_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION payroll.guard_run_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'A run that is % cannot be removed', OLD.status;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION 'A paid run cannot change';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'draft' AND NEW.status = 'in_review')
    OR (OLD.status = 'in_review' AND NEW.status IN ('draft', 'approved'))
    OR (OLD.status = 'approved' AND NEW.status = 'paid')
  ) THEN
    RAISE EXCEPTION 'Run status cannot make the transition % to %', OLD.status, NEW.status;
  END IF;
  IF OLD.status <> 'draft' AND (
    NEW.usd_rate_e4 IS DISTINCT FROM OLD.usd_rate_e4
    OR NEW.settings_snapshot IS DISTINCT FROM OLD.settings_snapshot
    OR NEW.period_start IS DISTINCT FROM OLD.period_start
    OR NEW.period_end IS DISTINCT FROM OLD.period_end
  ) THEN
    RAISE EXCEPTION 'The rate, settings and period can change only while the run is a draft';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pay_runs_guard BEFORE UPDATE OR DELETE ON payroll.pay_runs FOR EACH ROW EXECUTE FUNCTION payroll.guard_run_change();
--> statement-breakpoint
-- The first settings row: the cutoff divisor, the warning threshold, and no extra-hours multipliers until the owner supplies them.
INSERT INTO payroll.pay_settings (effective_from, cutoff_divisor, change_warn_bp) VALUES ('2000-01-01', 11, 1000);

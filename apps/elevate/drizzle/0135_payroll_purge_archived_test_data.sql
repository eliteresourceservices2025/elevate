-- Added by hand. Two changes:
-- 1. A cancelled run (a draft that was dropped, never approved, never paid) can be archived like a test run, so it can leave the lists.
-- 2. Archived TEST runs, archived cancelled runs and archived TEST invoices can be deleted for good, but only through
--    payroll.purge_archived_test_data(). The append-only and frozen-row triggers let a DELETE through only inside that function
--    (it switches on a transaction-local flag that nothing else sets) and the function picks the rows itself: a real run that was
--    approved or paid, a real invoice, and anything not archived are never touched.

-- Triggers: a DELETE passes only while the purge flag is on.
CREATE OR REPLACE FUNCTION payroll.purging() RETURNS boolean
LANGUAGE sql STABLE
SET search_path = ''
AS $$ SELECT coalesce(current_setting('payroll.purge', true), '') = 'on' $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION payroll.reject_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND payroll.purging() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ops.reject_invoice_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND payroll.purging() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION payroll.reject_frozen_run_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  run_status text;
BEGIN
  IF TG_OP = 'DELETE' AND payroll.purging() THEN
    RETURN OLD;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO run_status FROM payroll.pay_runs WHERE id = OLD.run_id FOR SHARE;
    IF run_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'The run is % and its lines and items are frozen', run_status;
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO run_status FROM payroll.pay_runs WHERE id = NEW.run_id FOR SHARE;
    IF run_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'The run is % and its lines and items are frozen', run_status;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- The run guard: a cancelled run can be archived too; a run is deleted only while purging, and only if it is archived and is a test or cancelled run.
CREATE OR REPLACE FUNCTION payroll.guard_run_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF payroll.purging() AND OLD.archived_at IS NOT NULL AND (OLD.is_test OR OLD.status = 'cancelled') THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'A pay run cannot be removed';
  END IF;
  IF NEW.archived_at IS NOT NULL AND NOT NEW.is_test AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'Only a test run or a cancelled run can be archived';
  END IF;
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at OR NEW.archived_by IS DISTINCT FROM OLD.archived_by THEN
    IF NOT ((OLD.is_test AND NEW.is_test) OR (OLD.status = 'cancelled' AND NEW.status = 'cancelled')) THEN
      RAISE EXCEPTION 'Only a test run or a cancelled run can be archived';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.is_test IS DISTINCT FROM OLD.is_test
      OR NEW.settings_snapshot IS DISTINCT FROM OLD.settings_snapshot
      OR NEW.period_start IS DISTINCT FROM OLD.period_start
      OR NEW.period_end IS DISTINCT FROM OLD.period_end
      OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
      OR NEW.decided_by IS DISTINCT FROM OLD.decided_by THEN
      RAISE EXCEPTION 'Archiving a run changes nothing else about it';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('paid', 'cancelled') THEN
    RAISE EXCEPTION 'A % run cannot change', OLD.status;
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'draft' AND NEW.status IN ('in_review', 'cancelled'))
    OR (OLD.status = 'in_review' AND NEW.status IN ('draft', 'approved'))
    OR (OLD.status = 'approved' AND NEW.status = 'paid')
  ) THEN
    RAISE EXCEPTION 'Run status cannot make the transition % to %', OLD.status, NEW.status;
  END IF;
  IF OLD.status <> 'draft' AND (
    NEW.settings_snapshot IS DISTINCT FROM OLD.settings_snapshot
    OR NEW.period_start IS DISTINCT FROM OLD.period_start
    OR NEW.period_end IS DISTINCT FROM OLD.period_end
  ) THEN
    RAISE EXCEPTION 'The settings and period can change only while the run is a draft';
  END IF;
  IF NEW.is_test IS DISTINCT FROM OLD.is_test AND OLD.is_test AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'A test run can be made a real run again only while it is a draft';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- An invoice's state is its newest event (none, or a restore, means live).
CREATE OR REPLACE FUNCTION ops.invoice_last_kind(p_invoice uuid) RETURNS text
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT e.kind FROM ops.invoice_events e WHERE e.invoice_id = p_invoice ORDER BY e.created_at DESC, e.id DESC LIMIT 1
$$;
--> statement-breakpoint
-- Deletes archived test data for good. p_runs: archived test runs and archived cancelled runs, with their children and their (test) invoices.
-- p_invoices: archived test invoices. A run stays when any invoice on it is real or still live; an invoice stays when a kept invoice was
-- replaced by it. Returns what was deleted and what is archived but had to stay.
CREATE OR REPLACE FUNCTION payroll.purge_archived_test_data(p_runs boolean, p_invoices boolean)
RETURNS TABLE (runs_deleted integer, invoices_deleted integer, runs_kept integer, invoices_kept integer)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  run_ids uuid[] := '{}';
  inv_ids uuid[] := '{}';
  blocked uuid[] := '{}';
  all_runs uuid[] := '{}';
  all_invs uuid[] := '{}';
  prev_runs integer;
  prev_blocked integer;
  new_blocked uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('pay_runs'));

  IF p_runs THEN
    SELECT coalesce(array_agg(r.id), '{}') INTO all_runs FROM payroll.pay_runs r WHERE r.archived_at IS NOT NULL AND (r.is_test OR r.status = 'cancelled');
  END IF;
  SELECT coalesce(array_agg(i.id), '{}') INTO all_invs FROM ops.invoices i WHERE i.is_test AND ops.invoice_last_kind(i.id) = 'archived';
  run_ids := all_runs;

  LOOP
    prev_runs := cardinality(run_ids);
    prev_blocked := cardinality(blocked);
    SELECT coalesce(array_agg(i.id), '{}') INTO inv_ids
      FROM ops.invoices i
      WHERE i.is_test AND NOT (i.id = ANY (blocked)) AND (
        (p_invoices AND ops.invoice_last_kind(i.id) = 'archived')
        OR (i.run_id = ANY (run_ids) AND ops.invoice_last_kind(i.id) IN ('archived', 'superseded'))
      );
    -- A run stays when any invoice on it is not going.
    SELECT coalesce(array_agg(r), '{}') INTO run_ids FROM unnest(run_ids) AS r
      WHERE NOT EXISTS (SELECT 1 FROM ops.invoices i WHERE i.run_id = r AND NOT (i.id = ANY (inv_ids)));
    -- An invoice stays when an invoice that stays points to it as its replacement.
    SELECT coalesce(array_agg(DISTINCT e.replaced_by), '{}') INTO new_blocked
      FROM ops.invoice_events e
      WHERE e.replaced_by = ANY (inv_ids) AND NOT (e.invoice_id = ANY (inv_ids));
    blocked := blocked || new_blocked;
    EXIT WHEN cardinality(run_ids) = prev_runs AND cardinality(new_blocked) = 0;
    EXIT WHEN cardinality(run_ids) = prev_runs AND cardinality(blocked) = prev_blocked;
  END LOOP;

  PERFORM set_config('payroll.purge', 'on', true);

  DELETE FROM ops.invoice_events WHERE invoice_id = ANY (inv_ids);
  DELETE FROM ops.invoices WHERE id = ANY (inv_ids);
  DELETE FROM payroll.timesheet_imports WHERE run_id = ANY (run_ids);
  DELETE FROM payroll.pay_run_releases WHERE run_id = ANY (run_ids);
  DELETE FROM payroll.pay_run_signatures WHERE run_id = ANY (run_ids);
  DELETE FROM payroll.pay_change_log WHERE run_id = ANY (run_ids);
  DELETE FROM payroll.pay_payments WHERE run_id = ANY (run_ids);
  DELETE FROM payroll.pay_approvals WHERE run_id = ANY (run_ids);
  DELETE FROM payroll.pay_run_items WHERE run_id = ANY (run_ids);
  DELETE FROM payroll.pay_run_lines WHERE run_id = ANY (run_ids);
  DELETE FROM payroll.pay_runs WHERE id = ANY (run_ids);

  PERFORM set_config('payroll.purge', 'off', true);

  runs_deleted := cardinality(run_ids);
  invoices_deleted := cardinality(inv_ids);
  runs_kept := cardinality(all_runs) - cardinality(run_ids);
  invoices_kept := (SELECT count(*)::integer FROM unnest(all_invs) AS a WHERE NOT (a = ANY (inv_ids)));
  RETURN NEXT;
END;
$$;
